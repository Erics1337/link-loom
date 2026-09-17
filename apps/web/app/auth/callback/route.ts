import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const isExtensionAuth = requestUrl.searchParams.get("extension") === "1";
  const extensionId = requestUrl.searchParams.get("ext_id");
  const authNonce = requestUrl.searchParams.get("nonce");
  let inviteCodeToRestore =
    requestUrl.searchParams.get("invite_code") ||
    requestUrl.searchParams.get("invite");

  const headersList = headers();
  const host =
    headersList.get("x-forwarded-host") ||
    headersList.get("host") ||
    "localhost:3000";
  const protocol = headersList.get("x-forwarded-proto") || "https";
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;

  const extensionCompleteUrl = (params: Record<string, string>) => {
    const url = new URL("/auth/extension-complete", origin);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  };

  const extensionCompleteParams = (params: Record<string, string>) => ({
    ...params,
    ...(authNonce ? { nonce: authNonce } : {}),
  });

  const cookiesToSet: { name: string; value: string; options: CookieOptions }[] = [];
  const cookieStore = cookies();

  const redirectWithCookies = (url: string) => {
    const response = NextResponse.redirect(url);
    for (const { name, value, options } of cookiesToSet) {
      response.cookies.set(name, value, options);
    }
    if (inviteCodeToRestore) {
      response.cookies.set("invite_code", inviteCodeToRestore, {
        path: "/",
        maxAge: 60 * 60,
        sameSite: "lax",
        secure: protocol === "https",
      });
    }
    return response;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookiesToSet.push({ name, value, options });
          try {
            cookieStore.set({ name, value, ...options });
          } catch {}
        },
        remove(name: string, options: CookieOptions) {
          cookiesToSet.push({ name, value: "", options: { ...options, maxAge: 0 } });
          try {
            cookieStore.set({ name, value: "", ...options, maxAge: 0 });
          } catch {}
        },
      },
    },
  );

  let exchangeFailed = false;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeFailed = Boolean(error);

    if (!error && data.session) {
      // Check if this is a new user (created within last 5 minutes = likely new signup)
      const userCreatedAt = new Date(data.session.user.created_at);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isNewUser = userCreatedAt > fiveMinutesAgo;

      const metadataInviteCode = data.session.user.user_metadata?.invite_code;
      if (!inviteCodeToRestore && typeof metadataInviteCode === "string") {
        inviteCodeToRestore = metadataInviteCode;
      }

      // Check for invite code in cookies or data forwarded from auth initiation.
      const hasInviteCode =
        Boolean(inviteCodeToRestore) ||
        cookieStore.has("invite_code") ||
        cookieStore.has("invite-code");

      const requireInvite =
        process.env.REQUIRE_INVITE_CODE === "true" && !isExtensionAuth;

      // Block new signups without invite if invite code is required
      if (requireInvite && isNewUser && !hasInviteCode) {
        // Sign them out immediately
        await supabase.auth.signOut();

        if (isExtensionAuth && extensionId) {
          return redirectWithCookies(
            extensionCompleteUrl(
              extensionCompleteParams({
                ext_id: extensionId,
                error: "waitlist_only",
              }),
            ),
          );
        }

        // Redirect to login with waitlist message
        return redirectWithCookies(
          origin +
            "/login?error=waitlist_only&message=Sign+up+is+currently+waitlist-only.+Please+join+the+waitlist+for+early+access.",
        );
      }
    }
  }

  if (isExtensionAuth && extensionId && (exchangeFailed || !code)) {
    return redirectWithCookies(
      extensionCompleteUrl(
        extensionCompleteParams({ ext_id: extensionId, error: "oauth_failed" }),
      ),
    );
  }

  if (isExtensionAuth && extensionId) {
    return redirectWithCookies(
      extensionCompleteUrl(extensionCompleteParams({ ext_id: extensionId })),
    );
  }

  // URL to redirect to after sign in process completes
  return redirectWithCookies(origin + "/dashboard");
}
