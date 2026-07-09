import { NextResponse } from "next/server";
import { requireApiUser } from "@/utils/api/auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  enforceSameOrigin,
  getAllowedCorsOrigin,
  rateLimit,
  sanitizeApiError,
  withCors,
} from "@/utils/api/security";

export async function OPTIONS(request: Request) {
  const response = new NextResponse(null, { status: 204 });
  const allowedOrigin = getAllowedCorsOrigin(request);
  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Access-Control-Allow-Methods", "DELETE, OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    response.headers.set("Access-Control-Max-Age", "600");
  }
  return response;
}

const getBearerToken = (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

const runDeletionStep = async (
  label: string,
  step: () => Promise<{ error: unknown }>,
) => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await step();
    if (!error) return;

    lastError = error;
    console.warn(
      `[Account Deletion] ${label} failed on attempt ${attempt}`,
      error,
    );
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }

  throw lastError;
};

const alertAccountDeletionCleanupFailure = (userId: string, error: unknown) => {
  console.error(
    "[Account Deletion] ALERT: auth user deleted but account data cleanup failed",
    {
      userId,
      reconciliationKey: `account-deletion:${userId}`,
      error,
    },
  );
};

const getRequestUser = async (request: Request) => {
  const bearerToken = getBearerToken(request);
  if (bearerToken) {
    const admin = createAdminClient();
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(bearerToken);

    if (error || !user) {
      return {
        supabase: null,
        user: null,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return { supabase: null, user, response: null };
  }

  const originError = enforceSameOrigin(request);
  if (originError) {
    return { supabase: null, user: null, response: originError };
  }

  return requireApiUser();
};

export async function DELETE(request: Request) {
  const {
    supabase,
    user,
    response: unauthorizedResponse,
  } = await getRequestUser(request);
  if (unauthorizedResponse) return withCors(request, unauthorizedResponse);
  if (!user) {
    return withCors(
      request,
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }

  const rateLimitError = await rateLimit({
    key: `account:delete:${user.id}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (rateLimitError) return withCors(request, rateLimitError);

  const admin = createAdminClient();

  try {
    await runDeletionStep("delete auth user", async () => {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      return { error };
    });

    try {
      await runDeletionStep("delete account data", async () => {
        const { error } = await admin.rpc("delete_user_account_data", {
          p_user_id: user.id,
        });
        return { error };
      });
    } catch (cleanupError) {
      alertAccountDeletionCleanupFailure(user.id, cleanupError);
    }

    await supabase?.auth.signOut();

    const response = NextResponse.json({ status: "deleted" });
    response.cookies.set("ll_last_seen", "", { path: "/", maxAge: 0 });
    return withCors(request, response);
  } catch (error) {
    return withCors(
      request,
      sanitizeApiError(
        "[Account Deletion] Error:",
        error,
        "Failed to delete account",
      ),
    );
  }
}
