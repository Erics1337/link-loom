import { LegalPage, LegalSection } from "../legal-page";

export const metadata = {
  title: "Privacy Policy | Link Loom",
  description: "Privacy Policy for Link Loom.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="What Link Loom Does">
        <p>
          Link Loom is a software service (Chrome extension + web app) that
          helps users organize, search, and manage bookmarks using AI-assisted
          features.
        </p>
      </LegalSection>

      <LegalSection title="Information We Collect">
        <p>
          We may collect account information (such as email address),
          authentication data, billing identifiers, and product usage
          information.
        </p>
        <p>
          To provide the service, we may process bookmark-related data and
          metadata that users choose to sync or organize through Link Loom.
        </p>
        <p>
          Payment card details are processed by Stripe. We do not store full
          payment card numbers on our servers.
        </p>
      </LegalSection>

      <LegalSection title="How We Use Information">
        <p>We use collected information to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>operate and improve Link Loom features,</li>
          <li>authenticate users and maintain accounts,</li>
          <li>process payments and manage subscriptions/licenses,</li>
          <li>provide customer support, and</li>
          <li>detect abuse, fraud, or security issues.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Sharing and Service Providers">
        <p>
          We may share limited information with service providers that help us
          run the product, such as payment processors (Stripe), hosting/database
          providers, and other infrastructure vendors.
        </p>
        <p>
          We may also disclose information when required by law or to protect
          the safety, rights, and security of our users and services.
        </p>
      </LegalSection>

      <LegalSection title="Data Retention and Security">
        <p>
          We retain information for as long as needed to provide the service,
          comply with legal obligations, resolve disputes, and enforce our
          agreements.
        </p>
        <p>
          We use reasonable administrative, technical, and organizational
          safeguards, but no method of transmission or storage is completely
          secure.
        </p>
      </LegalSection>

      <LegalSection title="Your Choices">
        <p>
          You may contact us to request account support, billing assistance, or
          account deletion, subject to legal and operational retention
          requirements.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For privacy questions or requests, contact{" "}
          <a href="mailto:support@linkloom.org" className="ll-link">
            support@linkloom.org
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
