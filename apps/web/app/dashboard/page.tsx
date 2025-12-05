import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { LayoutDashboard, Link as LinkIcon, Settings, CreditCard, LogOut, Search, Plus } from 'lucide-react'
import Image from 'next/image'

export default async function Dashboard() {
    const supabase = createClient()

    const {
        data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
        redirect('/login')
    }

    // Mock Data for UI
    const stats = [
        { name: 'Total Bookmarks', value: '1,234', change: '+12%', changeType: 'positive' },
        { name: 'Tags Created', value: '56', change: '+2.1%', changeType: 'positive' },
        { name: 'Storage Used', value: '45%', change: '2.4GB / 5GB', changeType: 'neutral' },
    ]

    const recentBookmarks = [
        { id: 1, title: 'React Documentation', url: 'https://react.dev', tag: 'Development', date: '2h ago' },
        { id: 2, title: 'Tailwind CSS Components', url: 'https://tailwindui.com', tag: 'Design', date: '4h ago' },
        { id: 3, title: 'Next.js 14 Features', url: 'https://nextjs.org/blog', tag: 'Development', date: '1d ago' },
        { id: 4, title: 'Stripe API Reference', url: 'https://stripe.com/docs/api', tag: 'Billing', date: '2d ago' },
    ]

    return (
        <div className="min-h-screen bg-gray-900 text-white flex">
            {/* Sidebar */}
            <aside className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col fixed h-full z-10">
                <div className="p-6 flex items-center gap-2 font-bold text-xl tracking-tight border-b border-gray-800">
                    <div className="relative w-8 h-8">
                        <Image
                            src="/logo.png"
                            alt="Link Loom Logo"
                            fill
                            className="object-contain"
                        />
                    </div>
                    Link Loom
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    <a href="#" className="flex items-center gap-3 px-4 py-3 text-blue-400 bg-blue-500/10 rounded-lg">
                        <LayoutDashboard className="w-5 h-5" />
                        Dashboard
                    </a>
                    <a href="#" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <LinkIcon className="w-5 h-5" />
                        My Links
                    </a>
                    <a href="#" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <Settings className="w-5 h-5" />
                        Settings
                    </a>
                    <a href="#" className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <CreditCard className="w-5 h-5" />
                        Billing
                    </a>
                </nav>

                <div className="p-4 border-t border-gray-800">
                    <div className="flex items-center gap-3 px-4 py-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{session.user.email}</p>
                            <p className="text-xs text-gray-500 truncate">Free Plan</p>
                        </div>
                    </div>
                    <form action="/auth/signout" method="post">
                        <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                            <LogOut className="w-4 h-4" />
                            Sign Out
                        </button>
                    </form>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto ml-64">
                {/* Topbar */}
                <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-10">
                    <h1 className="text-xl font-semibold">Dashboard</h1>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="text"
                                placeholder="Search links..."
                                className="bg-gray-800 border border-gray-700 rounded-full pl-10 pr-4 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-64 transition-colors"
                            />
                        </div>
                        <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 transition-colors">
                            <Plus className="w-4 h-4" />
                            Add Link
                        </button>
                    </div>
                </header>

                <div className="p-8 space-y-8">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                        {stats.map((item) => (
                            <div key={item.name} className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
                                <dt className="text-sm font-medium text-gray-400">{item.name}</dt>
                                <dd className="mt-2 flex items-baseline gap-2">
                                    <span className="text-3xl font-semibold text-white">{item.value}</span>
                                    <span className={`text-sm font-medium ${item.changeType === 'positive' ? 'text-green-400' : 'text-gray-500'}`}>
                                        {item.change}
                                    </span>
                                </dd>
                            </div>
                        ))}
                    </div>

                    {/* Recent Activity */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                            <h3 className="text-base font-semibold leading-6 text-white">Recent Bookmarks</h3>
                            <a href="#" className="text-sm font-medium text-blue-400 hover:text-blue-300">View all</a>
                        </div>
                        <ul role="list" className="divide-y divide-gray-700">
                            {recentBookmarks.map((item) => (
                                <li key={item.id} className="px-6 py-4 hover:bg-gray-800/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center flex-none">
                                            <LinkIcon className="w-5 h-5 text-gray-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-white truncate">{item.title}</p>
                                            <p className="text-xs text-gray-500 truncate">{item.url}</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="inline-flex items-center rounded-md bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-400/20">
                                                {item.tag}
                                            </span>
                                            <span className="text-sm text-gray-500">{item.date}</span>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Upgrade Banner */}
                    <div className="relative isolate overflow-hidden bg-gray-800 border border-gray-700 px-6 py-8 shadow-2xl rounded-2xl sm:px-16 md:pt-12 lg:flex lg:gap-x-20 lg:px-24 lg:pt-0">
                        <div className="mx-auto max-w-md text-center lg:mx-0 lg:flex-auto lg:py-16 lg:text-left">
                            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                Unlock full potential.<br />Start using Link Loom Pro today.
                            </h2>
                            <p className="mt-6 text-lg leading-8 text-gray-300">
                                Get unlimited bookmarks, advanced AI auto-tagging, and priority support.
                            </p>
                            <div className="mt-10 flex items-center justify-center gap-x-6 lg:justify-start">
                                <form action="/api/checkout" method="POST">
                                    <button type="submit" className="rounded-md bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                                        Upgrade to Pro
                                    </button>
                                </form>
                                <a href="#" className="text-sm font-semibold leading-6 text-white">
                                    Learn more <span aria-hidden="true">→</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
