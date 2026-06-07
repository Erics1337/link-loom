import type { FastifyInstance, FastifyRequest } from "fastify";

import { supabase } from "../db";

type RateBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateBucket>();

const pruneExpiredBuckets = () => {
  const now = Date.now();
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  });
};

const WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const CLEANUP_INTERVAL_MS = Number.parseInt(
  process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS ?? String(WINDOW_MS),
  10,
);

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

const startBucketCleanup = () => {
  if (cleanupTimer || process.env.NODE_ENV === "test") return;

  cleanupTimer = setInterval(pruneExpiredBuckets, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
};

export const stopBucketCleanup = () => {
  if (!cleanupTimer) return;

  clearInterval(cleanupTimer);
  cleanupTimer = null;
};

if (process.env.NODE_ENV !== "test") {
  startBucketCleanup();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, stopBucketCleanup);
  }
}

const AUTH_LIMIT = Number.parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? "30", 10);
const WRITE_LIMIT = Number.parseInt(process.env.RATE_LIMIT_WRITE_MAX ?? "120", 10);
const DEFAULT_LIMIT = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "300", 10);

const getClientKey = (req: FastifyRequest) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip =
    typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0]?.trim()
      : req.ip;
  return ip || "unknown";
};

const getLimitForRequest = (req: FastifyRequest) => {
  if (req.url.startsWith("/auth/")) return AUTH_LIMIT;
  if (req.method !== "GET" && req.method !== "HEAD") return WRITE_LIMIT;
  return DEFAULT_LIMIT;
};

export const registerRateLimit = async (fastify: FastifyInstance) => {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.RATE_LIMIT_STORE === "memory"
  ) {
    fastify.log.warn(
      "Using in-memory rate limiting. Use RATE_LIMIT_STORE=supabase or platform/shared rate limits in production.",
    );
  }

  fastify.addHook("onRequest", async (req, reply) => {
    if (process.env.NODE_ENV === "test") return;

    const now = Date.now();
    const limit = getLimitForRequest(req);
    const routeKey = req.routeOptions?.url || req.url;
    const key = `${req.method}:${routeKey}:${getClientKey(req)}`;

    if (process.env.RATE_LIMIT_STORE !== "memory") {
      try {
        const { data, error } = await supabase
          .rpc("consume_rate_limit", {
            p_rate_key: `backend:${key}`,
            p_limit: limit,
            p_window_seconds: Math.ceil(WINDOW_MS / 1000),
          })
          .single();

        if (error) throw error;

        if (data && !(data as { allowed?: boolean }).allowed) {
          const retryAfter =
            (data as { retry_after_seconds?: number }).retry_after_seconds ??
            Math.ceil(WINDOW_MS / 1000);
          return reply
            .code(429)
            .header("Retry-After", retryAfter)
            .send({ error: "Too many requests. Please try again later." });
        }

        return;
      } catch (error) {
        fastify.log.error(
          { err: error },
          "Shared rate limit check failed; falling back to in-memory limiter.",
        );
      }
    }

    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      return reply
        .code(429)
        .header("Retry-After", Math.ceil((bucket.resetAt - now) / 1000))
        .send({ error: "Too many requests. Please try again later." });
    }
  });
};
