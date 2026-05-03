"use client";

import { createClient } from "@/utils/supabase/client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Alert, Button, Card, Input } from "@link-loom/ui";
import { useSearchParams } from "next/navigation";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get("invite");
  const [view, setView] = useState<"sign-in" | "sign-up">("sign-in");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // Handle error from OAuth callback (waitlist block)
  useEffect(() => {
    const error = searchParams.get("error");
    const msg = searchParams.get("message");
    if (error === "waitlist_only" && msg) {
      setMessage(decodeURIComponent(msg.replace(/\+/g, " ")));
    }
  }, [searchParams]);

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data.session) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    setView("sign-in");
    setMessage("Account created. You can sign in now.");
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  return (
    <div className="ll-field-bg ll-map-grid flex min-h-screen flex-1 flex-col justify-center px-6 py-12 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="mb-10 flex items-center justify-center gap-2">
          <div className="relative h-12 w-12">
            <Image
              src="/logo.png"
              alt="Link Loom Logo"
              fill
              sizes="48px"
              className="object-contain"
            />
          </div>
        </Link>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-ll-accent">
          Access node
        </p>
        <h2 className="mt-3 text-center text-3xl font-semibold leading-tight tracking-tight text-ll-text">
          {view === "sign-in"
            ? "Sign in to your account"
            : "Create a new account"}
        </h2>
        <p className="mt-3 text-center text-sm leading-6 text-ll-muted">
          Sync your semantic bookmark map across the dashboard and extension.
        </p>
      </div>

      {/* Waitlist Banner - Always visible */}
      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <Alert tone="info" className="text-center">
          <p className="font-medium">🚀 Link Loom is in private beta</p>
          <p className="text-sm mt-1">
            New accounts are waitlist-only.{" "}
            <Link href="/#waitlist" className="underline font-semibold">
              Join the waitlist
            </Link>{" "}
            for early access.
          </p>
        </Alert>
      </div>

      <Card className="mt-6 p-5 sm:mx-auto sm:w-full sm:max-w-md" elevated>
        <div className="flex flex-col gap-4">
          <button
            onClick={async () => {
              setLoading(true);
              setMessage(null);

              // Set invite code cookie before OAuth so callback can check it
              if (inviteCode) {
                document.cookie = `invite_code=${inviteCode};path=/;max-age=3600`;
              }

              const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                  redirectTo: `${location.origin}/auth/callback`,
                },
              });
              if (error) {
                setMessage(error.message);
                setLoading(false);
              }
            }}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-ll-md border border-ll-border bg-ll-surface-solid px-3 py-2.5 text-sm font-semibold leading-6 text-ll-text shadow-sm transition hover:bg-ll-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <div className="relative">
            <div
              className="absolute inset-0 flex items-center"
              aria-hidden="true"
            >
              <div className="w-full border-t border-ll-border" />
            </div>
            <div className="relative flex justify-center text-sm font-medium leading-6">
              <span className="bg-ll-card px-6 text-ll-muted">
                Or continue with email
              </span>
            </div>
          </div>
        </div>

        <form
          className="space-y-6 mt-6"
          onSubmit={view === "sign-in" ? handleSignIn : handleSignUp}
        >
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium leading-6 text-ll-muted"
            >
              Email address
            </label>
            <div className="mt-2">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block py-2.5"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="password"
                className="block text-sm font-medium leading-6 text-ll-muted"
              >
                Password
              </label>
              {view === "sign-in" && (
                <div className="text-sm">
                  <a
                    href="#"
                    className="font-semibold text-ll-accent hover:text-ll-accent-text"
                  >
                    Forgot password?
                  </a>
                </div>
              )}
            </div>
            <div className="mt-2">
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  view === "sign-in" ? "current-password" : "new-password"
                }
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block py-2.5"
              />
            </div>
          </div>

          <div>
            <Button 
              type="submit" 
              disabled={loading || (view === "sign-up" && !inviteCode)} 
              className="w-full"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : view === "sign-in" ? (
                "Sign in"
              ) : inviteCode ? (
                "Sign up"
              ) : (
                "Join waitlist for access"
              )}
            </Button>
          </div>
        </form>

        {/* Sign-up Blocker - Only show when trying to sign up without invite */}
        {view === "sign-up" && !inviteCode && (
          <Alert tone="warning" className="mt-6">
            <p className="font-medium">Sign up is currently waitlist-only</p>
            <p className="text-sm mt-1">
              We&apos;re onboarding in small batches to ensure a great experience.{" "}
              <Link href="/#waitlist" className="underline font-semibold text-ll-accent">
                Join the waitlist
              </Link>{" "}
              and we&apos;ll send you an invite soon.
            </p>
          </Alert>
        )}

        {message && (
          <Alert
            className="mt-4"
            tone={message.toLowerCase().includes("error") ? "danger" : "info"}
          >
            {message}
          </Alert>
        )}

        <p className="mt-10 text-center text-sm text-ll-muted">
          {view === "sign-in" ? (
            <>
              Not a member?{" "}
              <button
                onClick={() => setView("sign-up")}
                className="font-semibold leading-6 text-ll-accent hover:text-ll-accent-text"
              >
                Try to create account
              </button>
              <span className="block mt-2 text-xs">
                (New signups are waitlist-only —{" "}
                <Link href="/#waitlist" className="underline">join here</Link>)
              </span>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setView("sign-in")}
                className="font-semibold leading-6 text-ll-accent hover:text-ll-accent-text"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
