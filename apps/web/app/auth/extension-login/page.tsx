import { Suspense } from "react";
import { ExtensionLoginClient } from "./ExtensionLoginClient";

export default function ExtensionLoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-ll-text-secondary">Connecting your extension…</p>
        </main>
      }
    >
      <ExtensionLoginClient />
    </Suspense>
  );
}
