import { LegalPage, LegalSection } from "../legal-page";

export const metadata = {
  title: "Privacy Policy | Link Loom",
  description: "Privacy Policy for Link Loom.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="June 15, 2026">
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
          To provide Link Loom, we process bookmark-related information that
          users choose to organize or save with the service. This may include
          bookmark titles, URLs, folder structure, generated folder names, short
          page descriptions, and limited page text used to improve search,
          clustering, and bookmark organization.
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
          <li>enrich bookmark metadata for search and organization,</li>
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
          providers, AI infrastructure providers, and other infrastructure
          vendors. For example, bookmark text may be sent to AI providers to
          create embeddings, generate folder names, or power related Link Loom
          features.
        </p>
        <p>
          We may also disclose information when required by law or to protect
          the safety, rights, and security of our users and services.
        </p>
      </LegalSection>

      <LegalSection title="Chrome Extension Data Use">
        <p>
          The Link Loom extension uses Chrome permissions to read and update
          bookmarks when you ask it to organize, import, restore, or apply
          changes. We use this data to provide and improve Link Loom&apos;s
          user-facing bookmark features, not for advertising or resale.
        </p>
        <p>
          Human review of user bookmark data is limited to cases such as support
          you request, security and abuse prevention, legal obligations, or
          internal work with aggregated or de-identified information.
        </p>
      </LegalSection>

      <LegalSection title="Data Retention and Security">
        <p>
          We retain information for as long as needed to provide the service,
          maintain your account, comply with legal obligations, resolve
          disputes, and enforce our agreements. Some operational records, such
          as payment records held by payment providers, may be retained as
          needed for normal business and legal purposes.
        </p>
        <p>
          We use reasonable administrative, technical, and organizational
          safeguards, including encrypted transmission for sensitive data.
        </p>
      </LegalSection>

      <LegalSection title="Your Choices">
        <p>
          You can delete your Link Loom account and cloud data from the web app
          dashboard or from the Chrome extension settings. Account deletion
          removes your Link Loom profile, synced bookmark records, generated
          folders, cloud snapshots, registered devices, and related processing
          state. It does not delete bookmarks stored locally in your browser.
        </p>
        <p>
          You may also contact us for account support, billing assistance, or
          privacy requests, subject to legal and operational retention
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
