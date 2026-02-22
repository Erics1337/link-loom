import Link from 'next/link'

export const metadata = {
    title: 'Privacy Policy | Link Loom',
    description: 'Privacy Policy for Link Loom.',
}

function Section({
    title,
    children,
}: {
    title: string
    children: React.ReactNode
}) {
    return (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <div className="mt-3 space-y-3 text-sm leading-6 text-gray-300">{children}</div>
        </section>
    )
}

export default function PrivacyPage() {
    return (
        <main className="min-h-screen bg-black text-white">
            <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
                <div className="mb-8 flex items-center justify-between gap-4">
                    <div>
                        <p className="text-sm text-gray-400">Effective date: February 22, 2026</p>
                        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
                    </div>
                    <Link
                        href="/"
                        className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
                    >
                        Back to Home
                    </Link>
                </div>

                <div className="space-y-6">
                    <Section title="What Link Loom Does">
                        <p>
                            Link Loom is a software service (Chrome extension + web app) that helps users organize,
                            search, and manage bookmarks using AI-assisted features.
                        </p>
                    </Section>

                    <Section title="Information We Collect">
                        <p>
                            We may collect account information (such as email address), authentication data, billing
                            identifiers, and product usage information.
                        </p>
                        <p>
                            To provide the service, we may process bookmark-related data and metadata that users choose
                            to sync or organize through Link Loom.
                        </p>
                        <p>
                            Payment card details are processed by Stripe. We do not store full payment card numbers on
                            our servers.
                        </p>
                    </Section>

                    <Section title="How We Use Information">
                        <p>We use collected information to:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>operate and improve Link Loom features,</li>
                            <li>authenticate users and maintain accounts,</li>
                            <li>process payments and manage subscriptions/licenses,</li>
                            <li>provide customer support, and</li>
                            <li>detect abuse, fraud, or security issues.</li>
                        </ul>
                    </Section>

                    <Section title="Sharing and Service Providers">
                        <p>
                            We may share limited information with service providers that help us run the product, such
                            as payment processors (Stripe), hosting/database providers, and other infrastructure vendors.
                        </p>
                        <p>
                            We may also disclose information when required by law or to protect the safety, rights, and
                            security of our users and services.
                        </p>
                    </Section>

                    <Section title="Data Retention and Security">
                        <p>
                            We retain information for as long as needed to provide the service, comply with legal
                            obligations, resolve disputes, and enforce our agreements.
                        </p>
                        <p>
                            We use reasonable administrative, technical, and organizational safeguards, but no method of
                            transmission or storage is completely secure.
                        </p>
                    </Section>

                    <Section title="Your Choices">
                        <p>
                            You may contact us to request account support, billing assistance, or account deletion,
                            subject to legal and operational retention requirements.
                        </p>
                    </Section>

                    <Section title="Contact">
                        <p>
                            For privacy questions or requests, contact{' '}
                            <a href="mailto:support@linkloom.org" className="text-blue-400 hover:text-blue-300">
                                support@linkloom.org
                            </a>
                            .
                        </p>
                    </Section>
                </div>
            </div>
        </main>
    )
}
