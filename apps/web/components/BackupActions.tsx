'use client'

import { useState } from 'react'
import { Undo2, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

export function BackupActions({
    snapshotId,
    snapshotName
}: {
    snapshotId: string
    snapshotName: string
}) {
    const [isLoading, setIsLoading] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    const handleRestore = async () => {
        if (!window.confirm(`Are you sure you want to restore the structure snapshot "${snapshotName}"? Your current folder structure will be permanently deleted and replaced.`)) {
            return
        }

        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error('Not logged in')

            const { error } = await supabase.rpc('restore_structure_snapshot', {
                p_user_id: user.id,
                p_snapshot_id: snapshotId
            })

            if (error) throw error
            
            alert('Snapshot restored successfully!')
            router.refresh()
        } catch (err: any) {
            console.error(err)
            alert(`Failed to restore snapshot. ${err.message}`)
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = async () => {
        if (!window.confirm(`Are you sure you want to permanently delete the backup "${snapshotName}"?`)) {
            return
        }

        setIsLoading(true)
        try {
            const { error } = await supabase
                .from('structure_snapshots')
                .delete()
                .eq('id', snapshotId)

            if (error) throw error

            router.refresh()
        } catch (err: any) {
            console.error(err)
            alert(`Failed to delete snapshot. ${err.message}`)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={handleRestore}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 hover:text-amber-400 transition-colors disabled:opacity-50"
                title="Restore this structure"
            >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                Restore
            </button>
            <button
                onClick={handleDelete}
                disabled={isLoading}
                className="flex items-center justify-center w-8 h-8 text-red-400 hover:text-white hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                title="Delete backup"
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    )
}
