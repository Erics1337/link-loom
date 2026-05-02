"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  CreditCard,
  Crown,
  LifeBuoy,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function BillingPage() {
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isSyncingCheckout, setIsSyncingCheckout] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutSucceeded = searchParams.get("success") === "true";
  const checkoutSessionId = searchParams.get("session_id");
  const isPremium = profile?.is_premium ?? false;
  const planName = isPremium
    ? profile?.subscription_status === "lifetime"
      ? "Pro Lifetime"
      : "Pro Plan"
    : "Free Tier";

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        const { data } = await supabase
          .from("users")
          .select("*")
          .eq("id", user.id)
          .single();
        setProfile(data);
      }
    };
    getUser();
  }, [supabase]);

  useEffect(() => {
    if (!checkoutSucceeded || !checkoutSessionId || !user) return;

    let cancelled = false;

    const syncCheckout = async () => {
      setIsSyncingCheckout(true);
      setCheckoutError(null);

      try {
        const response = await fetch("/api/checkout/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: checkoutSessionId }),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || "Failed to sync checkout session");
        }

        if (!cancelled && payload.profile) {
          setProfile(payload.profile);
          router.refresh();
        }
      } catch (error) {
        if (!cancelled) {
          setCheckoutError(
            error instanceof Error
              ? error.message
              : "Failed to activate Pro access.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsSyncingCheckout(false);
        }
      }
    };

    syncCheckout();

    return () => {
      cancelled = true;
    };
  }, [checkoutSucceeded, checkoutSessionId, user, supabase]);

  const handleCheckout = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    setLoading(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
      });
      const { url, error } = await res.json();
      if (!res.ok || !url) {
        throw new Error(error || "Failed to start checkout");
      }
      window.location.href = url;
    } catch (error) {
      console.error("Checkout error:", error);
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Failed to start checkout. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const planHighlights = isPremium
    ? [
        {
          icon: Crown,
          title: "Lifetime access",
          description:
            "One payment, no renewals, full Pro access stays on your account.",
        },
        {
          icon: Sparkles,
          title: "Unlimited bookmarks",
          description:
            "Keep organizing without the free-tier 500 bookmark cap.",
        },
        {
          icon: ShieldCheck,
          title: "Expanded device sync",
          description:
            "Use Link Loom across more than 3 devices without hitting the starter limit.",
        },
        {
          icon: LifeBuoy,
          title: "Priority support",
          description:
            "Support requests from Pro users move to the front of the line.",
        },
      ]
    : [
        {
          icon: Sparkles,
          title: "Unlimited bookmarks",
          description:
            "Organize your full archive without worrying about the cap.",
        },
        {
          icon: ShieldCheck,
          title: "Expanded device sync",
          description:
            "Use Link Loom across more than 3 devices with one account.",
        },
        {
          icon: LifeBuoy,
          title: "Priority support",
          description: "Get faster help when you hit a workflow snag.",
        },
      ];

  return (
    <>
      <header className="ll-topbar">
        <h1 className="text-xl font-semibold text-ll-text">Billing</h1>
      </header>

      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {checkoutSucceeded && (
          <div className="flex items-center gap-3 rounded-ll-lg border border-ll-success/30 bg-ll-success/10 p-4 text-ll-success">
            <div className="h-2 w-2 rounded-full bg-ll-success" />
            {profile?.is_premium
              ? "Payment successful. Your Pro access is active."
              : isSyncingCheckout
                ? "Payment successful. Activating Pro access..."
                : "Payment successful. Refreshing your billing status..."}
          </div>
        )}
        {searchParams.get("canceled") && (
          <div className="flex items-center gap-3 rounded-ll-lg border border-ll-warning/30 bg-ll-warning/10 p-4 text-ll-warning">
            <div className="h-2 w-2 rounded-full bg-ll-warning" />
            Payment canceled. You have not been charged.
          </div>
        )}
        {searchParams.get("already_premium") && (
          <div className="flex items-center gap-3 rounded-ll-lg border border-ll-accent/30 bg-ll-accent-soft p-4 text-ll-accent-text">
            <div className="h-2 w-2 rounded-full bg-ll-accent" />
            You already have Pro access.
          </div>
        )}

        {checkoutError && (
          <div className="flex items-center gap-3 rounded-ll-lg border border-ll-danger/30 bg-ll-danger/10 p-4 text-ll-danger">
            <div className="h-2 w-2 shrink-0 rounded-full bg-ll-danger" />
            <p className="text-sm">{checkoutError}</p>
          </div>
        )}

        <div className="ll-panel relative p-8">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ll-accent/60 to-transparent" />
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="ll-tag">
                <CreditCard className="h-3.5 w-3.5" />
                Billing status
              </div>
              <p className="mb-1 mt-5 text-sm text-ll-muted">Current plan</p>
              <p className="text-3xl font-bold text-ll-text">{planName}</p>
              <p className="mt-3 max-w-2xl text-sm text-ll-muted">
                {isPremium
                  ? "Your account is unlocked for the full Link Loom experience, including unlimited bookmarks, expanded device sync, and priority support."
                  : "Upgrade once for lifetime Pro access and remove the free-tier limits from your account."}
              </p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-ll-lg border border-ll-border bg-ll-card p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ll-muted">
                    Plan
                  </p>
                  <p className="mt-2 text-base font-semibold text-ll-text">
                    {planName}
                  </p>
                </div>
                <div className="rounded-ll-lg border border-ll-border bg-ll-card p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ll-muted">
                    Billing
                  </p>
                  <p className="mt-2 text-base font-semibold text-ll-text">
                    {isPremium ? "One-time payment" : "$29 one-time"}
                  </p>
                </div>
                <div className="rounded-ll-lg border border-ll-border bg-ll-card p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ll-muted">
                    Renewal
                  </p>
                  <p className="mt-2 text-base font-semibold text-ll-text">
                    {isPremium ? "No recurring charge" : "None after purchase"}
                  </p>
                </div>
              </div>
            </div>

            {!isPremium && (
              <button
                onClick={handleCheckout}
                disabled={loading}
                className="ll-action-primary min-w-[220px] px-8 py-3 disabled:opacity-50"
              >
                {loading ? "Processing..." : "Upgrade to Pro ($29)"}
              </button>
            )}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 border-t border-ll-border pt-6 md:grid-cols-2">
            {planHighlights.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-ll-lg border border-ll-border bg-ll-card p-5"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-ll-md bg-ll-accent-soft p-2 text-ll-accent">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="font-semibold text-ll-text">{item.title}</h3>
                  </div>
                  <p className="mt-3 text-sm text-ll-muted">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {isPremium && (
          <div className="ll-panel p-8">
            <div className="flex items-start gap-4">
              <div className="rounded-ll-lg bg-ll-success/10 p-3 text-ll-success">
                <BadgeCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-ll-text">
                  Your Pro access is active
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-ll-muted">
                  The upgrade is attached to this account, and the dashboard
                  will keep showing Pro anywhere we read your billing profile.
                </p>
                <div className="mt-5 flex flex-wrap gap-3 text-sm">
                  <span className="rounded-full border border-ll-success/30 bg-ll-success/10 px-3 py-1 text-ll-success">
                    Status: {profile?.subscription_status || "active"}
                  </span>
                  {profile?.subscription_id && (
                    <span className="rounded-full border border-ll-border bg-ll-card px-3 py-1 text-ll-muted">
                      Receipt ref:{" "}
                      {String(profile.subscription_id).slice(0, 18)}...
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
