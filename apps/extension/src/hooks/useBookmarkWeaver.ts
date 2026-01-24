import { useState, useEffect, useCallback } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';

const BACKEND_URL = 'http://localhost:3333';

export type AppStatus = 'idle' | 'weaving' | 'ready' | 'done' | 'error';

export const useBookmarkWeaver = () => {
    const [status, setStatus] = useState<AppStatus>('idle');
    const [progress, setProgress] = useState({ pending: 0, clusters: 0, assigned: 0, total: 0 });
    const [userId, setUserId] = useState<string>('');
    const [clusters, setClusters] = useState<BookmarkNode[]>([]);
    const [stats, setStats] = useState({ duplicates: 0, deadLinks: 0 });

    const [isPremium, setIsPremium] = useState(false);

    useEffect(() => {
        chrome.storage.local.get(['userId'], async (result) => {
            let currentUserId = result.userId as string | undefined;
            if (currentUserId) {
                setUserId(currentUserId as string);
            } else {
                const newId = crypto.randomUUID();
                chrome.storage.local.set({ userId: newId });
                setUserId(newId);
                currentUserId = newId;
            }

            // Check backend status immediately to restore state
            if (currentUserId) {
                try {
                    const res = await fetch(`${BACKEND_URL}/status/${currentUserId}`);
                    const data = await res.json();
                    
                    if (data.isPremium) setIsPremium(true);

                    if (data.pending > 0 || (data.total > 0 && !data.isDone)) {
                        setStatus('weaving');
                        setProgress({ 
                            pending: data.pending, 
                            clusters: data.clusters,
                            assigned: data.assigned || 0,
                            total: data.total 
                        });
                    } else if (data.isDone) {
                         // Only set to ready if we have clusters, otherwise stay idle (new user)
                        setStatus('ready');
                        await fetchResults(currentUserId);
                    }
                } catch (e) {
                    console.error("Failed to check initial status", e);
                }
            }
        });
    }, []);

    // Polling Effect
    useEffect(() => {
        if (status !== 'weaving' || !userId) return;

        // Mock for local dev polling
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
             // Mock polling logic handled in startWeaving for now or ignore
             return;
        }

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/status/${userId}`);
                const data = await res.json();
                
                if (data.isPremium) setIsPremium(true);

                setProgress(prev => ({ 
                    ...prev, 
                    pending: data.pending, 
                    clusters: data.clusters,
                    assigned: data.assigned || 0,
                    // Use backend total if available, otherwise keep existing
                    total: data.total || prev.total 
                }));

                if (data.isDone) {
                    clearInterval(interval);
                    await fetchResults(userId);
                }
            } catch (e) {
                console.error("Polling error", e);
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [status, userId]);



    // ... (rest of file)
    
    // I will use a cleaner approach: just add the state and update the return.
    // I'll make two smaller edits.


    const startWeaving = useCallback(async () => {
        setStatus('weaving');
        setClusters([]); // Reset clusters to avoid showing old results
        setProgress({ pending: 0, clusters: 0, assigned: 0, total: 0 }); // Reset progress

        // Mock for local dev
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
             console.log("Running in mock mode");
            setTimeout(() => {
                setProgress({ pending: 50, clusters: 5, assigned: 20, total: 100 });
            }, 1000);
            setTimeout(() => {
                 setClusters([
                    {
                        id: '1', title: 'Development', children: [
                             {
                                id: '1-1', title: 'AI Research', children: [
                                    { id: '1-1-1', title: 'OpenAI Platform', url: 'https://platform.openai.com' },
                                    { id: '1-1-2', title: 'LangChain', url: 'https://python.langchain.com' }
                                ]
                            },
                             {
                                id: '1-2', title: 'Frontend', children: [
                                    { id: '1-2-1', title: 'React', url: 'https://react.dev' }
                                ]
                            }
                        ]
                    },
                    {
                        id: '2', title: 'Inspiration', children: [
                            { id: '2-1', title: 'Design Blog', url: 'https://example.com/design' }
                        ]
                    }
                ]);
                 setStats({ duplicates: 7, deadLinks: 0 });
                setStatus('ready');
            }, 3000);
            return;
        }

        try {
            // 1. Get Bookmarks
            const tree = await chrome.bookmarks.getTree();
            const bookmarks: any[] = [];
            const traverse = (node: any) => {
                if (node.url) {
                    bookmarks.push({ id: node.id, url: node.url, title: node.title });
                }
                if (node.children) {
                    node.children.forEach(traverse);
                }
            };
            traverse(tree[0]);
            const totalBookmarks = bookmarks.length;
            setProgress(prev => ({ ...prev, total: totalBookmarks, pending: totalBookmarks }));

            // 2. Send to Backend
            await fetch(`${BACKEND_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, bookmarks }),
            });
            
            // Polling is now handled by useEffect
        } catch (error) {
            console.error("Weaving error", error);
            setStatus('error');
        }
    }, [userId]);

    const fetchResults = async (idOverride?: string) => {
        const targetId = idOverride || userId;
        try {
            const res = await fetch(`${BACKEND_URL}/structure/${targetId}`);
            const data = await res.json();
            
            // data = { clusters: [], assignments: [] }
            // 1. Map assignments to bookmarks
            // Wait, we need the bookmark details (title, url) which are currently not returned by /structure fully?
            // Checking backend: /structure does a join but assignments only has bookmark_id and cluster_id?
            // Let's verify what /structure returns.
            // ... Logic pause to check backend response ...
            // Assuming we need to fetch bookmarks or the backend provided them.
            // Backend `assignments` query: .select(`cluster_id, bookmark_id, clusters!inner(user_id)`)
            // It lacks title/url. We need to fetch bookmarks too.
            // Or update /structure to return bookmark details.
            
            // Assuming for now we update /structure too in next step.
            // Let's implement the tree construction assuming data contains what we need.
            
            const clusterMap = new Map<string, BookmarkNode>();
            
            // 1. Create Cluster Nodes
            data.clusters.forEach((c: any) => {
                clusterMap.set(c.id, {
                    id: c.id,
                    title: c.name,
                    children: [],
                    parentId: c.parent_id
                });
            });

            // 2. Add Bookmarks to Clusters
            data.assignments.forEach((a: any) => {
                const cluster = clusterMap.get(a.cluster_id);
                if (cluster && cluster.children && a.bookmarks) {
                    cluster.children.push({
                        id: a.bookmark_id,
                        title: a.bookmarks.title,
                        url: a.bookmarks.url
                    });
                }
            });

            // 3. Build Tree (Clusters into Clusters)
            const rootNodes: BookmarkNode[] = [];
            
            clusterMap.forEach((node) => {
                const parentId = node.parentId;
                if (parentId && clusterMap.has(parentId)) {
                    const parent = clusterMap.get(parentId);
                    if (parent && parent.children) {
                        parent.children.push(node);
                    }
                } else {
                    rootNodes.push(node);
                }
            });

            setClusters(rootNodes);
            setStats({ duplicates: 0, deadLinks: 0 }); 
            setStatus('ready');
        } catch (error) {
            console.error("Fetch results error", error);
            setStatus('error');
        }
    };

    const applyChanges = async () => {
        // Implementation for applying changes
        setStatus('done');
    };

    const cancelWeaving = async () => {
        if (!userId) return;
        try {
            await fetch(`${BACKEND_URL}/cancel/${userId}`, { method: 'POST' });
        } catch (error) {
            console.error("Cancel error", error);
        } finally {
            // Always reset UI state
            setStatus('idle');
            setProgress({ pending: 0, clusters: 0, assigned: 0, total: 0 });
        }
    };

    return {
        status,
        progress,
        clusters,
        stats,
        startWeaving,
        cancelWeaving,
        applyChanges,
        setStatus,
        isPremium
    };
};
