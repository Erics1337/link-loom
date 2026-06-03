import Link from "next/link";
import type { ReactNode } from "react";

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="ll-doc-section">
      <h2 className="text-xl font-semibold text-ll-text">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-ll-muted">
        {children}
      </div>
    </section>
  );
}

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="ll-field-bg min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ll-muted">
              Effective date: February 22, 2026
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
          </div>
          <Link href="/" className="ll-action-secondary px-4 py-2 text-sm">
            Back to Home
          </Link>
        </div>

        <div className="space-y-6">{children}</div>
      </div>
    </main>
  );
}
