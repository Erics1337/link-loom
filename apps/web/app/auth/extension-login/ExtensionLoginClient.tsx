"use client";

import { createClient } from "@/utils/supabase/client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const ALLOWED_EXTENSION_IDS = new Set(
  (process.env.NEXT_PUBLIC_LINK_LOOM_EXTENSION_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const isAllowedExtensionId = (extensionId: string) =>
  ALLOWED_EXTENSION_IDS.has(extensionId);

export function ExtensionLoginClient() {
  const searchParams = useSearchParams();
  const extId = searchParams.get("ext_id");
  const nonce = searchParams.get("nonce");
  const [message, setMessage] = useState("Connecting your extension…");

  useEffect(() => {
    if (!extId || !nonce) {
      setMessage(
        "Missing extension sign-in details. Close this tab and try again from the extension.",
      );
      return;
    }

    if (!isAllowedExtensionId(extId)) {
      setMessage(
        "Invalid extension ID. Close this tab and try again from the official Link Loom extension.",
      );
      return;
    }

    let cancelled = false;

    const connect = async () => {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (cancelled) return;

        if (session) {
          window.location.href = `/auth/extension-complete?ext_id=${encodeURIComponent(extId)}&nonce=${encodeURIComponent(nonce)}`;
          return;
        }

        setMessage("Redirecting to Google…");

        const redirectTo = `${window.location.origin}/auth/callback?extension=1&ext_id=${encodeURIComponent(extId)}&nonce=${encodeURIComponent(nonce)}`;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });

        if (!cancelled && error) {
          setMessage(error.message);
        }
      } catch {
        if (!cancelled) {
          setMessage(
            "Could not start extension sign in. Close this tab and try again.",
          );
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
    };
  }, [extId, nonce]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-ll-text-secondary">{message}</p>
    </main>
  );
}
