"use client";

import { useState, type FormEvent } from "react";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";

interface WaitlistFormProps {
  onSuccess?: () => void;
}

export function WaitlistForm({ onSuccess }: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      setStatus("error");
      setMessage("Please enter your email address");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        setStatus("success");
        setMessage(data.message || "You're on the waitlist!");
        setEmail("");
        onSuccess?.();
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong. Please try again.");
      }
    } catch (error) {
      setStatus("error");
      setMessage("Failed to connect. Please try again later.");
    }
  };

  if (status === "success") {
    return (
      <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-lg border border-[color:var(--ll-accent)] bg-[var(--ll-accent-soft)] px-6 py-8">
        <CheckCircle2 className="h-10 w-10 text-[var(--ll-accent)]" />
        <p className="text-center text-lg font-semibold text-[var(--ll-text)]">
          {message}
        </p>
        <p className="text-center text-sm text-[var(--ll-muted)]">
          We&apos;ll be in touch soon with early access details.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ll-muted)]" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            disabled={status === "loading"}
            className="w-full border border-[color:var(--ll-border)] bg-[var(--ll-surface-solid)] py-3 pl-11 pr-4 text-sm text-[var(--ll-text)] placeholder:text-[var(--ll-muted)] focus:border-[color:var(--ll-accent)] focus:outline-none disabled:opacity-50"
            aria-label="Email address"
          />
        </div>
        <button
          type="submit"
          disabled={status === "loading"}
          className="inline-flex items-center justify-center gap-2 bg-[var(--ll-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--ll-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Joining...
            </>
          ) : (
            "Join waitlist"
          )}
        </button>
      </div>
      
      {status === "error" && message && (
        <p className="mt-3 text-sm text-red-500">{message}</p>
      )}
    </form>
  );
}
