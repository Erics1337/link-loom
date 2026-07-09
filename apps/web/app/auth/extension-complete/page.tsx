import { Suspense } from "react";
import { ExtensionCompleteClient } from "./ExtensionCompleteClient";

export default function ExtensionCompletePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-ll-text-secondary">Finishing sign in…</p>
        </main>
      }
    >
      <ExtensionCompleteClient />
    </Suspense>
  );
}
