'use client'

import { useState } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

export function AddLinkModal() {
    const [isOpen, setIsOpen] = useState(false)
    const [url, setUrl] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setSuccess(false)
        setIsLoading(true)

        try {
            // Basic URL validation
            new URL(url)
            
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                throw new Error('You must be logged in to add a link.')
            }

            // Write straight to db; backend ingestion queues will take over
            const { error: dbError } = await supabase
                .from('bookmarks')
                .insert({
                    user_id: user.id,
                    url,
                    title: 'Adding link...', // Placeholder until enriched
                    status: 'pending'
                })

            if (dbError) throw dbError

            setSuccess(true)
            setTimeout(() => {
                setIsOpen(false)
                setUrl('')
                setSuccess(false)
            }, 1500) // Delay closing so they can see the success message
            
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Failed to add link. Ensure it is a valid URL.')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <>
            <button 
                onClick={() => setIsOpen(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 transition-colors"
            >
                <Plus className="w-4 h-4" />
                Add Link
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden">
                        <div className="flex items-center justify-between p-6 border-b border-gray-800">
                            <h2 className="text-xl font-semibold text-white">Add New Link</h2>
                            <button 
                                onClick={() => setIsOpen(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label htmlFor="url" className="block text-sm font-medium text-gray-300 mb-2">
                                    URL to Bookmark
                                </label>
                                <input
                                    id="url"
                                    type="url"
                                    required
                                    placeholder="https://example.com/article"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                                />
                            </div>

                            {error && (
                                <p className="text-sm font-medium text-red-400 bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                                    {error}
                                </p>
                            )}

                            {success && (
                                <p className="text-sm font-medium text-green-400 bg-green-400/10 p-3 rounded-lg border border-green-400/20">
                                    Link added successfully! Processing...
                                </p>
                            )}

                            <div className="flex justify-end gap-3 mt-8">
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isLoading || !url}
                                    className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        'Save Bookmark'
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    )
}
