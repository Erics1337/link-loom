"use client";

import { createClient } from "@/utils/supabase/client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function ExtensionLoginClient() {
  const searchParams = useSearchParams();
  const extId = searchParams.get("ext_id");
  const [message, setMessage] = useState("Connecting your extension…");

  useEffect(() => {
    if (!extId) {
      setMessage("Missing extension ID. Close this tab and try again from the extension.");
      return;
    }

    let cancelled = false;

    const connect = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (session) {
        window.location.href = `/auth/extension-complete?ext_id=${encodeURIComponent(extId)}`;
        return;
      }

      setMessage("Redirecting to Google…");

      const redirectTo = `${window.location.origin}/auth/callback?extension=1&ext_id=${encodeURIComponent(extId)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (!cancelled && error) {
        setMessage(error.message);
      }
    };

    connect();

    return () => {
      cancelled = true;
    };
  }, [extId]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-ll-text-secondary">{message}</p>
    </main>
  );
}
