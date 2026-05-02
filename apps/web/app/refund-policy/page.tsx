import Link from "next/link";

export const metadata = {
  title: "Refund and Cancellation Policy | Link Loom",
  description: "Refund and cancellation policy for Link Loom.",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
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

export default function RefundPolicyPage() {
  return (
    <main className="ll-field-bg min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ll-muted">
              Effective date: February 22, 2026
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Refund and Cancellation Policy
            </h1>
          </div>
          <Link href="/" className="ll-action-secondary px-4 py-2 text-sm">
            Back to Home
          </Link>
        </div>

        <div className="space-y-6">
          <Section title="Digital Product Delivery">
            <p>
              Link Loom is a digital software product. Paid access is delivered
              electronically after successful payment. We do not ship physical
              goods.
            </p>
          </Section>

          <Section title="Subscription Cancellation">
            <p>
              If you purchase a recurring subscription, you may cancel at any
              time before your next billing date to avoid future charges.
              Cancellation stops future renewals but does not delete your
              account unless you request account deletion separately.
            </p>
          </Section>

          <Section title="Refunds for Subscriptions">
            <p>
              If you are charged in error, please contact us promptly and we
              will review and correct the issue.
            </p>
            <p>
              For first-time subscription purchases, refund requests submitted
              within 14 days of the charge may be approved at our discretion (or
              where required by law), especially if the service is not
              functioning as described.
            </p>
            <p>
              Renewal charges are generally non-refundable once the billing
              period has started, except where required by law.
            </p>
          </Section>

          <Section title="Refunds for One-Time Purchases or Lifetime Access">
            <p>
              For one-time purchases (including lifetime access offers), refund
              requests submitted within 14 days of purchase may be approved at
              our discretion (or where required by law), depending on account
              activity, product usage, and evidence of misuse.
            </p>
          </Section>

          <Section title="How to Request a Refund or Billing Review">
            <p>
              Email{" "}
              <a href="mailto:support@linkloom.org" className="ll-link">
                support@linkloom.org
              </a>{" "}
              with:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>the email address used for your Link Loom account,</li>
              <li>the purchase date, and</li>
              <li>
                a brief description of the issue or reason for the request.
              </li>
            </ul>
          </Section>

          <Section title="Chargebacks">
            <p>
              If you have a billing concern, please contact support before
              initiating a chargeback so we can attempt to resolve the issue
              quickly.
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
