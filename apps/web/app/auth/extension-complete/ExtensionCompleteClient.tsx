"use client";

import { createClient } from "@/utils/supabase/client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const WAITLIST_MESSAGE =
  "Sign up is currently waitlist-only. Please join the waitlist for early access.";

const getChromeRuntime = () => {
  const chromeGlobal = globalThis as typeof globalThis & {
    chrome?: { runtime?: { sendMessage: (...args: unknown[]) => void; lastError?: { message?: string } } };
  };

  return chromeGlobal.chrome?.runtime ?? null;
};

export function ExtensionCompleteClient() {
  const searchParams = useSearchParams();
  const extId = searchParams.get("ext_id");
  const errorCode = searchParams.get("error");
  const [message, setMessage] = useState("Finishing sign in…");

  useEffect(() => {
    if (!extId) {
      setMessage("Missing extension ID. Close this tab and try again from the extension.");
      return;
    }

    const runtime = getChromeRuntime();
    if (!runtime) {
      setMessage(
        "Could not reach the Link Loom extension. Make sure it is installed, then try again."
      );
      return;
    }

    if (errorCode === "waitlist_only") {
      runtime.sendMessage(extId, {
        type: "LINK_LOOM_EXTENSION_AUTH_ERROR",
        error: "waitlist_only",
        message: WAITLIST_MESSAGE,
      });
      setMessage(WAITLIST_MESSAGE);
      return;
    }

    let cancelled = false;

    const finish = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!session) {
        setMessage("No active session found. Close this tab and try again from the extension.");
        runtime.sendMessage(extId, {
          type: "LINK_LOOM_EXTENSION_AUTH_ERROR",
          error: "no_session",
          message: "No active session found.",
        });
        return;
      }

      runtime.sendMessage(
        extId,
        {
          type: "LINK_LOOM_EXTENSION_AUTH",
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user: {
            id: session.user.id,
            email: session.user.email ?? null,
          },
        },
        () => {
          if (cancelled) return;

          if (runtime.lastError) {
            setMessage(
              "Could not send your session to the extension. Make sure Link Loom is installed."
            );
            return;
          }

          setMessage("Signed in. You can close this tab and return to the extension.");
          window.setTimeout(() => window.close(), 1500);
        }
      );
    };

    finish();

    return () => {
      cancelled = true;
    };
  }, [errorCode, extId]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-ll-text-secondary">{message}</p>
    </main>
  );
}
