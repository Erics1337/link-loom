import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Check, Link as LinkIcon, Search, Share2, Sparkles, Tag, Zap } from 'lucide-react'
import { CardBody, CardContainer, CardItem } from '@/components/ui/3d-card'

export default function Home() {
    return (
        <div className="min-h-screen flex flex-col">
            {/* Navigation */}
            <nav className="fixed w-full z-50 bg-black/50 backdrop-blur-xl border-b border-white/10">
                <div className="container mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="relative w-8 h-8">
                            <Image
                                src="/logo.png"
                                alt="Link Loom Logo"
                                fill
                                className="object-contain"
                            />
                        </div>
                        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-violet-400">
                            Link Loom
                        </span>
                    </div>
                    <nav className="flex gap-6 text-sm font-medium text-gray-400">
                        <Link href="#features" className="hover:text-white transition-colors">Features</Link>
                        <Link href="#pricing" className="hover:text-white transition-colors">Pricing</Link>
                        <Link href="/login" className="text-white hover:text-blue-400 transition-colors">Log In</Link>
                    </nav>
                </div>
            </nav>

            <main className="flex-1">
                {/* Hero Section */}
                <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 overflow-hidden">
                    <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(colors.blue.900),black)] opacity-50" />
                    <div className="mx-auto max-w-7xl px-6 lg:px-8 text-center flex justify-center">
                        <CardContainer className="inter-var">
                            <CardBody className="bg-gray-900 relative group/card hover:shadow-2xl hover:shadow-blue-500/[0.1] border-white/[0.2] w-auto sm:w-[50rem] h-auto rounded-xl p-6 border flex flex-col items-center">
                                <CardItem translateZ="100" className="w-full mt-4 flex justify-center">
                                    <Image
                                        src="/logo.png"
                                        height="1000"
                                        width="1000"
                                        className="h-60 w-auto object-contain rounded-xl group-hover/card:shadow-xl"
                                        alt="Link Loom Logo"
                                    />
                                </CardItem>
                                <CardItem translateZ="60" className="w-full">
                                    <h1 className="text-5xl sm:text-7xl font-bold tracking-tight bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent pb-4">
                                        Weave your links <br /> into knowledge.
                                    </h1>
                                </CardItem>
                                <CardItem translateZ="50" className="w-full">
                                    <p className="mt-6 text-lg leading-8 text-gray-400 max-w-2xl mx-auto">
                                        Stop losing important links in endless bookmark folders. Link Loom uses AI to automatically organize, tag, and make your bookmarks searchable by meaning, not just keywords.
                                    </p>
                                </CardItem>
                                <CardItem translateZ="40" className="w-full">
                                    <div className="mt-10 flex items-center justify-center gap-x-6">
                                        <Link
                                            href="/login"
                                            className="rounded-full bg-blue-600 px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-all hover:scale-105"
                                        >
                                            Get Started for Free
                                        </Link>
                                        <Link href="#features" className="text-sm font-semibold leading-6 text-white flex items-center gap-1 hover:gap-2 transition-all">
                                            Learn more <ArrowRight className="w-4 h-4" />
                                        </Link>
                                    </div>
                                </CardItem>
                            </CardBody>
                        </CardContainer>
                    </div>
                </section>

                {/* Features Section */}
                <section id="features" className="py-24 sm:py-32 bg-black/50">
                    <div className="mx-auto max-w-7xl px-6 lg:px-8">
                        <div className="mx-auto max-w-2xl lg:text-center">
                            <h2 className="text-base font-semibold leading-7 text-blue-500">Faster Workflow</h2>
                            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                Everything you need to manage your digital brain
                            </p>
                        </div>
                        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
                            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-2">
                                <div className="flex flex-col">
                                    <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-white">
                                        <Search className="h-5 w-5 flex-none text-blue-500" />
                                        Semantic Search
                                    </dt>
                                    <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-400">
                                        <p className="flex-auto">Don't remember the exact title? No problem. Search by concept like "react tutorial" and find links about hooks, components, and state.</p>
                                    </dd>
                                </div>
                                <div className="flex flex-col">
                                    <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-white">
                                        <Zap className="h-5 w-5 flex-none text-blue-500" />
                                        Auto-Tagging
                                    </dt>
                                    <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-400">
                                        <p className="flex-auto">AI automatically analyzes the content of your saved pages and applies relevant tags. No more manual organization.</p>
                                    </dd>
                                </div>
                                <div className="flex flex-col">
                                    <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-white">
                                        <Share2 className="h-5 w-5 flex-none text-blue-500" />
                                        Shared Knowledge
                                    </dt>
                                    <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-400">
                                        <p className="flex-auto">Benefit from the community. If someone else has already indexed a link, you get the metadata instantly.</p>
                                    </dd>
                                </div>
                                <div className="flex flex-col">
                                    <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-white">
                                        <Sparkles className="h-5 w-5 flex-none text-blue-500" />
                                        Clean & Optimize
                                    </dt>
                                    <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-400">
                                        <p className="flex-auto">Automatically identify and remove duplicate bookmarks and dead links to keep your collection healthy and up-to-date.</p>
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </section>

                {/* Pricing Section */}
                <section id="pricing" className="py-24 sm:py-32">
                    <div className="mx-auto max-w-7xl px-6 lg:px-8">
                        <div className="mx-auto max-w-2xl sm:text-center">
                            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Simple, transparent pricing</h2>
                            <p className="mt-6 text-lg leading-8 text-gray-400">
                                Start for free, upgrade when you need more power.
                            </p>
                        </div>
                        <div className="mx-auto mt-16 max-w-2xl rounded-3xl ring-1 ring-white/10 sm:mt-20 lg:mx-0 lg:flex lg:max-w-none">
                            <div className="p-8 sm:p-10 lg:flex-auto">
                                <h3 className="text-2xl font-bold tracking-tight text-white">Pro Membership</h3>
                                <p className="mt-6 text-base leading-7 text-gray-400">
                                    Unlock the full power of Link Loom with unlimited bookmarks, advanced AI analysis, and priority support.
                                </p>
                                <div className="mt-10 flex items-center gap-x-4">
                                    <h4 className="flex-none text-sm font-semibold leading-6 text-blue-500">What's included</h4>
                                    <div className="h-px flex-auto bg-gray-100/10" />
                                </div>
                                <ul role="list" className="mt-8 grid grid-cols-1 gap-4 text-sm leading-6 text-gray-300 sm:grid-cols-2 sm:gap-6">
                                    {[
                                        'Unlimited Bookmarks (Free up to 500)',
                                        'Advanced Semantic Algorithm',
                                        'Smart Bookmark Renaming',
                                        'Remove Duplicates & Dead Links',
                                        'Priority Support',
                                        'Early Access to Features'
                                    ].map((feature) => (
                                        <li key={feature} className="flex gap-x-3">
                                            <Check className="h-6 w-5 flex-none text-blue-500" aria-hidden="true" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="-mt-2 p-2 lg:mt-0 lg:w-full lg:max-w-md lg:flex-shrink-0">
                                <div className="rounded-2xl bg-gray-900 py-10 text-center ring-1 ring-inset ring-white/10 lg:flex lg:flex-col lg:justify-center lg:py-16">
                                    <div className="mx-auto max-w-xs px-8">
                                        <p className="text-base font-semibold text-gray-400">Monthly</p>
                                        <p className="mt-6 flex items-baseline justify-center gap-x-2">
                                            <span className="text-5xl font-bold tracking-tight text-white">$10</span>
                                            <span className="text-sm font-semibold leading-6 text-gray-400">/month</span>
                                        </p>
                                        <Link
                                            href="/login"
                                            className="mt-10 block w-full rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                        >
                                            Get access
                                        </Link>
                                        <p className="mt-6 text-xs leading-5 text-gray-400">
                                            Invoices and receipts available for easy company reimbursement
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="border-t border-white/10 py-12 px-6 lg:px-8">
                <div className="mx-auto max-w-7xl flex justify-between items-center">
                    <p className="text-gray-500 text-sm">© 2024 Link Loom. All rights reserved.</p>
                    <div className="flex gap-4">
                        {/* Social links could go here */}
                    </div>
                </div>
            </footer>
        </div>
    )
}
