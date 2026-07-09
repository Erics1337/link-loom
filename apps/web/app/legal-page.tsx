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

function formatEffectiveDate(effectiveDate: string | Date): string {
  if (typeof effectiveDate === "string") {
    return effectiveDate.trim();
  }
  return effectiveDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function LegalPage({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate?: string | Date;
  children: ReactNode;
}) {
  const effectiveDateLabel = effectiveDate
    ? formatEffectiveDate(effectiveDate)
    : "";

  return (
    <main className="ll-field-bg min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            {effectiveDateLabel ? (
              <p className="text-sm text-ll-muted">
                Effective date: {effectiveDateLabel}
              </p>
            ) : null}
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
