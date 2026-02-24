import { createClient } from '@/utils/supabase/server'
import { Link as LinkIcon, Search, FolderTree, ExternalLink } from 'lucide-react'
import { AddLinkModal } from '@/components/AddLinkModal'

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

export default async function LinksPage({
    searchParams,
}: {
    searchParams?: { query?: string; page?: string }
}) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return <div>Please log in</div>
    }

    const query = searchParams?.query || ''
    const currentPage = Number(searchParams?.page) || 1
    const ITEMS_PER_PAGE = 20
    const offset = (currentPage - 1) * ITEMS_PER_PAGE

    let dbQuery = supabase
        .from('bookmarks')
        .select(`
            id, 
            title, 
            url, 
            description,
            created_at,
            status,
            cluster_assignments (
                clusters (name)
            )
        `, { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + ITEMS_PER_PAGE - 1)

    if (query) {
        // Simple search across title, url, description
        dbQuery = dbQuery.or(`title.ilike.%${query}%,url.ilike.%${query}%,description.ilike.%${query}%`)
    }

    const { data: bookmarks, count } = await dbQuery
    
    const totalPages = count ? Math.ceil(count / ITEMS_PER_PAGE) : 0

    return (
        <div>
            {/* Topbar */}
            <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-10">
                <h1 className="text-xl font-semibold">My Links</h1>
                <div className="flex items-center gap-4">
                    {/* Native HTML form for searchParams routing */}
                    <form method="GET" action="/dashboard/links" className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            name="query"
                            defaultValue={query}
                            placeholder="Search links..."
                            className="bg-gray-800 border border-gray-700 rounded-full pl-10 pr-4 py-1.5 text-sm focus:outline-none focus:border-blue-500 w-64 transition-colors text-white"
                        />
                    </form>
                    <AddLinkModal />
                </div>
            </header>

            <div className="p-8">
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                        <h3 className="text-base font-semibold leading-6 text-white">
                            {query ? `Search Results for "${query}"` : 'All Bookmarks'}
                        </h3>
                        <span className="text-sm text-gray-400">{count} total</span>
                    </div>

                    {!bookmarks || bookmarks.length === 0 ? (
                        <div className="px-6 py-12 text-center text-gray-500">
                            <LinkIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>{query ? 'No bookmarks found matching your search.' : 'You have no links saved yet.'}</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-700">
                            {bookmarks.map((bookmark: any) => {
                                const clusterName = bookmark.cluster_assignments?.[0]?.clusters?.name
                                return (
                                    <li key={bookmark.id} className="p-6 hover:bg-gray-800/50 transition-colors">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3 mb-1">
                                                    <h4 className="text-base font-medium text-white line-clamp-1">
                                                        {bookmark.title || bookmark.url}
                                                    </h4>
                                                    {clusterName && (
                                                        <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-400/20">
                                                            <FolderTree className="w-3 h-3" />
                                                            {clusterName}
                                                        </span>
                                                    )}
                                                </div>
                                                <a 
                                                    href={bookmark.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors line-clamp-1 mb-2 max-w-max"
                                                >
                                                    {bookmark.url}
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                                {bookmark.description && (
                                                    <p className="text-sm text-gray-400 line-clamp-2 mb-3">
                                                        {bookmark.description}
                                                    </p>
                                                )}
                                                <div className="flex items-center gap-4 text-xs text-gray-500">
                                                    <span>Added {formatRelativeTime(bookmark.created_at)}</span>
                                                    <span className="capitalize px-1.5 py-0.5 rounded-full bg-gray-800 border border-gray-700">
                                                        Status: {bookmark.status}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
                            <div className="text-sm text-gray-400">
                                Showing <span className="font-medium text-white">{offset + 1}</span> to <span className="font-medium text-white">{Math.min(offset + ITEMS_PER_PAGE, count || 0)}</span> of <span className="font-medium text-white">{count}</span> results
                            </div>
                            <div className="flex items-center gap-2">
                                {currentPage > 1 && (
                                    <a 
                                        href={`/dashboard/links?page=${currentPage - 1}${query ? `&query=${encodeURIComponent(query)}` : ''}`}
                                        className="px-3 py-1.5 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 hover:text-white transition-colors"
                                    >
                                        Previous
                                    </a>
                                )}
                                {currentPage < totalPages && (
                                    <a 
                                        href={`/dashboard/links?page=${currentPage + 1}${query ? `&query=${encodeURIComponent(query)}` : ''}`}
                                        className="px-3 py-1.5 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 hover:text-white transition-colors"
                                    >
                                        Next
                                    </a>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
