import { headers, cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number;
};

const getAllowedExtensionIds = () =>
  new Set(
    (process.env.NEXT_PUBLIC_LINK_LOOM_EXTENSION_IDS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const buckets = new Map<string, { count: number; resetAt: number }>();

const BUCKET_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const pruneExpiredBuckets = () => {
  const now = Date.now();
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  });
};

if (process.env.NODE_ENV !== "test") {
  const cleanupTimer = setInterval(
    pruneExpiredBuckets,
    BUCKET_CLEANUP_INTERVAL_MS,
  );
  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }
}

if (
  process.env.NODE_ENV === "production" &&
  process.env.RATE_LIMIT_STORE === "memory"
) {
  console.warn(
    "Using in-memory API route rate limiting. Use RATE_LIMIT_STORE=supabase or platform/shared rate limits in production.",
  );
}

const hashString = (str: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
};

const getClientIp = () => {
  const headerList = headers();

  // Gate use of x-forwarded-for and x-real-ip behind trusted-proxy/edge checks
  const isTrustedProxy =
    process.env.TRUST_PROXY === "true" ||
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV !== "production";

  if (isTrustedProxy) {
    const forwardedFor = headerList
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    if (forwardedFor) return forwardedFor;
    const realIp = headerList.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }

  // Fall back to a server-side-safe identifier
  const authHeader = headerList.get("authorization")?.trim();
  if (authHeader) {
    return `auth:${hashString(authHeader)}`;
  }

  try {
    const cookieList = cookies();
    const sbCookie = cookieList
      .getAll()
      .find((c) => c.name.startsWith("sb-"))?.value;
    if (sbCookie) {
      return `session:${hashString(sbCookie)}`;
    }
  } catch {
    // cookies() can throw when evaluated during static rendering/generation
  }

  return "anonymous";
};

export const getRequestOrigin = (request: Request) => {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");
  return new URL(request.url).origin;
};

export const getAllowedCorsOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (siteOrigin && origin === siteOrigin) return origin;

  const extensionMatch = origin.match(/^chrome-extension:\/\/([^/]+)$/);
  if (extensionMatch && getAllowedExtensionIds().has(extensionMatch[1])) {
    return origin;
  }

  return null;
};

export const withCors = (request: Request, response: NextResponse) => {
  const allowedOrigin = getAllowedCorsOrigin(request);
  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Vary", "Origin");
  }
  return response;
};

export const enforceSameOrigin = (request: Request) => {
  const headerList = headers();
  const expectedOrigin = getRequestOrigin(request);

  const origin = headerList.get("origin")?.trim();
  const referer = headerList.get("referer")?.trim();

  let originMatches = false;
  if (origin) {
    originMatches = origin === expectedOrigin;
  }

  let refererMatches = false;
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      refererMatches = refererOrigin === expectedOrigin;
    } catch {
      // Ignore invalid URL formatting in referer
    }
  }

  if (!originMatches && !refererMatches) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
};

const inMemoryRateLimit = ({ key, limit, windowMs }: RateLimitOptions) => {
  const now = Date.now();
  const rateKey = `${key}:${getClientIp()}`;
  const bucket = buckets.get(rateKey);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(rateKey, { count: 1, resetAt: now + windowMs });
    return null;
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil((bucket.resetAt - now) / 1000).toString(),
        },
      },
    );
  }

  return null;
};

export const rateLimit = async ({ key, limit, windowMs }: RateLimitOptions) => {
  if (process.env.RATE_LIMIT_STORE === "memory") {
    return inMemoryRateLimit({ key, limit, windowMs });
  }

  try {
    const admin = createAdminClient();
    const rateKey = `${key}:${getClientIp()}`;
    const { data, error } = await admin
      .rpc("consume_rate_limit", {
        p_rate_key: rateKey,
        p_limit: limit,
        p_window_seconds: Math.ceil(windowMs / 1000),
      })
      .single();

    if (error) throw error;

    const result = data as RateLimitResult | null;

    if (!result?.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              result?.retry_after_seconds ?? Math.ceil(windowMs / 1000),
            ),
          },
        },
      );
    }

    return null;
  } catch (error) {
    console.error(
      "Shared rate limit check failed; falling back to in-memory limiter.",
      error,
    );
    return inMemoryRateLimit({ key, limit, windowMs });
  }
};

export const sanitizeApiError = (
  logPrefix: string,
  error: unknown,
  message = "Request failed",
) => {
  console.error(logPrefix, error);
  return NextResponse.json({ error: message }, { status: 500 });
};
