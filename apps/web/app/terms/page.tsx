import Link from "next/link";
import { LegalPage, LegalSection } from "../legal-page";

export const metadata = {
  title: "Terms of Service | Link Loom",
  description: "Terms of Service for Link Loom.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" effectiveDate="February 22, 2026">
      <LegalSection title="Overview">
        <p>
          These Terms of Service govern access to and use of Link Loom, a
          software service that helps users organize and search bookmarks using
          AI-assisted features.
        </p>
        <p>By using Link Loom, you agree to these terms.</p>
      </LegalSection>

      <LegalSection title="Accounts">
        <p>
          You may need to create an account to access certain features. You are
          responsible for maintaining the confidentiality of your account
          credentials and for activity under your account.
        </p>
        <p>
          You must provide accurate information and keep your contact and
          billing information reasonably up to date.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable Use">
        <p>You agree not to use Link Loom to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>violate any law or third-party rights,</li>
          <li>upload or process unlawful or harmful content,</li>
          <li>interfere with service operation or security, or</li>
          <li>
            abuse the service through unauthorized automation or scraping.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Payments, Pricing, and Billing">
        <p>
          Paid features are billed in U.S. dollars (USD) through Stripe. Pricing
          may include recurring subscriptions and/or one-time license offers as
          presented at checkout.
        </p>
        <p>
          By completing a purchase, you authorize the applicable payment and any
          recurring charges associated with your selected plan until canceled.
        </p>
      </LegalSection>

      <LegalSection title="Cancellation and Refunds">
        <p>
          Subscription cancellation and refund terms are described in our public
          Refund and Cancellation Policy.
        </p>
        <p>
          <Link href="/refund-policy" className="ll-link">
            View Refund and Cancellation Policy
          </Link>
        </p>
      </LegalSection>

      <LegalSection title="Service Availability">
        <p>
          We may update, improve, or modify the service over time. We do not
          guarantee uninterrupted or error-free operation at all times.
        </p>
      </LegalSection>

      <LegalSection title="Intellectual Property">
        <p>
          Link Loom and related branding, software, and site content are owned
          by Link Loom or its licensors, except for content provided by users.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer and Limitation of Liability">
        <p>
          Link Loom is provided on an &quot;as is&quot; and &quot;as
          available&quot; basis to the extent permitted by law. To the maximum
          extent permitted by law, Link Loom disclaims implied warranties and is
          not liable for indirect, incidental, special, consequential, or
          punitive damages.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For billing, support, or legal questions, contact{" "}
          <a href="mailto:support@linkloom.org" className="ll-link">
            support@linkloom.org
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
