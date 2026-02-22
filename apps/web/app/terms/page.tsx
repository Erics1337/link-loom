import Link from 'next/link'

export const metadata = {
    title: 'Terms of Service | Link Loom',
    description: 'Terms of Service for Link Loom.',
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

export default function TermsPage() {
    return (
        <main className="min-h-screen bg-black text-white">
            <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
                <div className="mb-8 flex items-center justify-between gap-4">
                    <div>
                        <p className="text-sm text-gray-400">Effective date: February 22, 2026</p>
                        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Terms of Service</h1>
                    </div>
                    <Link
                        href="/"
                        className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
                    >
                        Back to Home
                    </Link>
                </div>

                <div className="space-y-6">
                    <Section title="Overview">
                        <p>
                            These Terms of Service govern access to and use of Link Loom, a software service that helps
                            users organize and search bookmarks using AI-assisted features.
                        </p>
                        <p>By using Link Loom, you agree to these terms.</p>
                    </Section>

                    <Section title="Accounts">
                        <p>
                            You may need to create an account to access certain features. You are responsible for
                            maintaining the confidentiality of your account credentials and for activity under your
                            account.
                        </p>
                        <p>
                            You must provide accurate information and keep your contact and billing information
                            reasonably up to date.
                        </p>
                    </Section>

                    <Section title="Acceptable Use">
                        <p>You agree not to use Link Loom to:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>violate any law or third-party rights,</li>
                            <li>upload or process unlawful or harmful content,</li>
                            <li>interfere with service operation or security, or</li>
                            <li>abuse the service through unauthorized automation or scraping.</li>
                        </ul>
                    </Section>

                    <Section title="Payments, Pricing, and Billing">
                        <p>
                            Paid features are billed in U.S. dollars (USD) through Stripe. Pricing may include
                            recurring subscriptions and/or one-time license offers as presented at checkout.
                        </p>
                        <p>
                            By completing a purchase, you authorize the applicable payment and any recurring charges
                            associated with your selected plan until canceled.
                        </p>
                    </Section>

                    <Section title="Cancellation and Refunds">
                        <p>
                            Subscription cancellation and refund terms are described in our public Refund and
                            Cancellation Policy.
                        </p>
                        <p>
                            <Link href="/refund-policy" className="text-blue-400 hover:text-blue-300">
                                View Refund and Cancellation Policy
                            </Link>
                        </p>
                    </Section>

                    <Section title="Service Availability">
                        <p>
                            We may update, improve, or modify the service over time. We do not guarantee uninterrupted
                            or error-free operation at all times.
                        </p>
                    </Section>

                    <Section title="Intellectual Property">
                        <p>
                            Link Loom and related branding, software, and site content are owned by Link Loom or its
                            licensors, except for content provided by users.
                        </p>
                    </Section>

                    <Section title="Disclaimer and Limitation of Liability">
                        <p>
                            Link Loom is provided on an &quot;as is&quot; and &quot;as available&quot; basis to the extent
                            permitted by law. To the maximum extent permitted by law, Link Loom disclaims implied
                            warranties and is not liable for indirect, incidental, special, consequential, or punitive
                            damages.
                        </p>
                    </Section>

                    <Section title="Contact">
                        <p>
                            For billing, support, or legal questions, contact{' '}
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
