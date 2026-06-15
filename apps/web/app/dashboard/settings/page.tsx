"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "Delete your Link Loom account and cloud data? Your Chrome bookmarks will stay in your browser.",
    );
    if (!confirmed) return;

    const finalConfirmed = window.confirm(
      "This cannot be undone. Delete account now?",
    );
    if (!finalConfirmed) return;

    setIsDeleting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete account");
      }

      router.replace("/login?message=account_deleted");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to delete account. Please try again.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <header className="ll-topbar">
        <h1 className="text-xl font-semibold text-ll-text">Settings</h1>
      </header>

      <div className="mx-auto max-w-4xl p-8">
        <section className="ll-panel-solid p-6">
          <h2 className="text-lg font-semibold text-ll-text">Account</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ll-muted">
            Manage your Link Loom account and cloud data. Deleting your account
            removes your saved Link Loom data, including synced bookmarks,
            generated folders, cloud snapshots, devices, and account profile.
            It does not delete bookmarks stored locally in Chrome.
          </p>
        </section>

        <section className="mt-6 border border-ll-danger/30 bg-ll-danger/5 p-6 ll-panel-solid">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-ll-danger" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-ll-text">
                Delete Account
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ll-muted">
                This permanently removes your Link Loom account and cloud data.
                Billing records may remain with payment providers as required
                for normal business and legal records.
              </p>
              {message ? (
                <p className="mt-3 text-sm font-medium text-ll-danger">
                  {message}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="mt-5 inline-flex items-center gap-2 rounded-ll-md bg-ll-danger px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
