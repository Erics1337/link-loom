import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const INACTIVITY_TIMEOUT_MS = Number.parseInt(
  process.env.SESSION_INACTIVITY_TIMEOUT_MS ?? `${8 * 60 * 60 * 1000}`,
  10,
);
const LAST_SEEN_COOKIE = "ll_last_seen";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: "",
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: "",
            ...options,
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtectedPath =
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/api/bookmarks") ||
    request.nextUrl.pathname.startsWith("/api/checkout");

  if (user && isProtectedPath && INACTIVITY_TIMEOUT_MS > 0) {
    const now = Date.now();
    const lastSeen = Number.parseInt(
      request.cookies.get(LAST_SEEN_COOKIE)?.value ?? "0",
      10,
    );

    if (lastSeen && now - lastSeen > INACTIVITY_TIMEOUT_MS) {
      await supabase.auth.signOut();

      if (request.nextUrl.pathname.startsWith("/api/")) {
        const expiredResponse = NextResponse.json(
          { error: "Session expired" },
          { status: 401 },
        );
        expiredResponse.cookies.set(LAST_SEEN_COOKIE, "", {
          path: "/",
          maxAge: 0,
        });
        return expiredResponse;
      }

      const redirectResponse = NextResponse.redirect(
        new URL("/login?message=session_expired", request.nextUrl),
      );
      redirectResponse.cookies.set(LAST_SEEN_COOKIE, "", {
        path: "/",
        maxAge: 0,
      });
      return redirectResponse;
    }

    response.cookies.set(LAST_SEEN_COOKIE, now.toString(), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: Math.ceil(INACTIVITY_TIMEOUT_MS / 1000),
    });
  }

  // Protected routes
  if (request.nextUrl.pathname.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }

  if (request.nextUrl.pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/dashboard", request.nextUrl));
  }

  return response;
}
