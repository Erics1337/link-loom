import { createClient } from '@/utils/supabase/server'
import { Link as LinkIcon, Search, Plus, Bookmark, FolderTree } from 'lucide-react'

// Helper to format relative time
function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
}

export default async function Dashboard() {
    const supabase = createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return <div>Please log in</div>
    }

    // Fetch real stats from Supabase
    const [bookmarkResult, clusterResult, recentResult, userResult] = await Promise.all([
        // Total bookmark count
        supabase
            .from('bookmarks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id),

        // Cluster/folder count
        supabase
            .from('clusters')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id),

        // Recent bookmarks with cluster assignments
        supabase
            .from('bookmarks')
            .select(`
                id, 
                title, 
                url, 
                created_at,
                cluster_assignments (
                    clusters (name)
                )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(5),

        // Get user premium status
        supabase
            .from('users')
            .select('is_premium')
            .eq('id', user.id)
            .single()
    ])

    const bookmarkCount = bookmarkResult.count ?? 0
    const clusterCount = clusterResult.count ?? 0
    const recentBookmarks = recentResult.data ?? []
    const isPremium = userResult.data?.is_premium ?? false
    const bookmarkLimit = isPremium ? '∞' : '500'

    const stats = [
        { name: 'Total Bookmarks', value: bookmarkCount.toLocaleString(), change: `of ${bookmarkLimit}`, changeType: 'neutral' as const },
        { name: 'Folders Created', value: clusterCount.toLocaleString(), change: 'organized', changeType: 'positive' as const },
        { name: 'Plan', value: isPremium ? 'Pro' : 'Free', change: isPremium ? 'Unlimited' : '500 limit', changeType: isPremium ? 'positive' as const : 'neutral' as const },
    ]

    return (
        <div>
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
                            <dt className="text-sm font-medium text-gray-400 flex items-center gap-2">
                                {item.name === 'Total Bookmarks' && <Bookmark className="w-4 h-4" />}
                                {item.name === 'Folders Created' && <FolderTree className="w-4 h-4" />}
                                {item.name}
                            </dt>
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
                        <span className="text-sm text-gray-500">{bookmarkCount} total</span>
                    </div>
                    {recentBookmarks.length === 0 ? (
                        <div className="px-6 py-12 text-center text-gray-500">
                            <Bookmark className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>No bookmarks yet. Install the extension to get started!</p>
                        </div>
                    ) : (
                        <ul role="list" className="divide-y divide-gray-700">
                            {recentBookmarks.map((item: any) => {
                                const clusterName = item.cluster_assignments?.[0]?.clusters?.name
                                return (
                                    <li key={item.id} className="px-6 py-4 hover:bg-gray-800/50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center flex-none">
                                                <LinkIcon className="w-5 h-5 text-gray-400" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-white truncate">{item.title || 'Untitled'}</p>
                                                <p className="text-xs text-gray-500 truncate">{item.url}</p>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                {clusterName && (
                                                    <span className="inline-flex items-center rounded-md bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-400/20">
                                                        {clusterName}
                                                    </span>
                                                )}
                                                <span className="text-sm text-gray-500">{formatRelativeTime(item.created_at)}</span>
                                            </div>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>

                {/* Upgrade Banner - Only show for free users */}
                {!isPremium && (
                    <div className="relative isolate overflow-hidden bg-gray-800 border border-gray-700 px-6 py-8 shadow-2xl rounded-2xl sm:px-16 md:pt-12 lg:flex lg:gap-x-20 lg:px-24 lg:pt-0">
                        <div className="mx-auto max-w-md text-center lg:mx-0 lg:flex-auto lg:py-16 lg:text-left">
                            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                Unlock full potential.<br />Start using Link Loom Pro today.
                            </h2>
                            <p className="mt-6 text-lg leading-8 text-gray-300">
                                Get unlimited bookmarks, advanced AI auto-tagging, and priority support.
                            </p>
                            <div className="mt-10 flex items-center justify-center gap-x-6 lg:justify-start">
                                <a href="/dashboard/billing" className="rounded-md bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                                    Upgrade to Pro
                                </a>
                                <a href="#" className="text-sm font-semibold leading-6 text-white">
                                    Learn more <span aria-hidden="true">→</span>
                                </a>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
