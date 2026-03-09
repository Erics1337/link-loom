import { createClient } from '@/utils/supabase/server'
import { History, Save } from 'lucide-react'
import { BackupActions } from '@/components/BackupActions'

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

export default async function BackupsPage() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return <div>Please log in</div>
    }

    // Fetch snapshots
    const { data: snapshots, count } = await supabase
        .from('structure_snapshots')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

    return (
        <div>
            {/* Topbar */}
            <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <History className="w-5 h-5 text-gray-400" />
                    <h1 className="text-xl font-semibold">Structure Backups</h1>
                </div>
            </header>

            <div className="p-8">
                <div className="mb-8 max-w-3xl">
                    <h2 className="text-lg font-medium text-white mb-2">Preserve your organized clusters</h2>
                    <p className="text-gray-400">
                        Link Loom dynamically reorganizes your bookmarks using artificial intelligence. 
                        If you want to freeze a particular folder structure before running a new organization job, 
                        you can create a snapshot from the Link Loom browser extension. You can then restore your 
                        bookmarks to this exact structure at any time.
                    </p>
                </div>

                <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden max-w-4xl">
                    <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-900/40">
                        <h3 className="text-base font-semibold text-white">Saved Snapshots</h3>
                        <span className="text-sm text-gray-400">{count || 0} backups limit of 10</span>
                    </div>

                    {!snapshots || snapshots.length === 0 ? (
                        <div className="px-6 py-12 text-center text-gray-500">
                            <Save className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>You haven't saved any structure backups yet.</p>
                            <p className="text-sm mt-2">Open the Link Loom browser extension to create your first backup.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-700">
                            {snapshots.map((snapshot: any) => (
                                <li key={snapshot.id} className="p-6 hover:bg-gray-800/50 transition-colors flex items-center justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <h4 className="text-base font-medium text-white line-clamp-1">
                                                {snapshot.name}
                                            </h4>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span>Saved {formatRelativeTime(snapshot.created_at)}</span>
                                            <span className="font-mono bg-gray-950 px-2 py-0.5 rounded border border-gray-800">
                                                ID: {snapshot.id.split('-').pop()}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    <div className="flex-shrink-0">
                                        <BackupActions 
                                            snapshotId={snapshot.id}
                                            snapshotName={snapshot.name}
                                        />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    )
}
