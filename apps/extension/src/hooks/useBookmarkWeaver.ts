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

            // 2. Pre-check: Warn if over limit and not premium
            const FREE_TIER_LIMIT = 500;
            if (!isPremium && totalBookmarks > FREE_TIER_LIMIT) {
                console.warn(`[WEAVING] User has ${totalBookmarks} bookmarks, exceeds free tier limit of ${FREE_TIER_LIMIT}`);
                // We'll still try to send - backend will enforce and give detailed error
            }

            // 3. Send to Backend
            const response = await fetch(`${BACKEND_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, bookmarks }),
            });

            // Handle 402 Payment Required (limit exceeded)
            if (response.status === 402) {
                const errorData = await response.json();
                console.error('[WEAVING] Limit exceeded:', errorData);
                setStats({ 
                    duplicates: 0, 
                    deadLinks: 0 
                });
                // Set error with a message that can be displayed
                setStatus('error');
                // Store error message in localStorage for display
                if (typeof chrome !== 'undefined' && chrome.storage) {
                    chrome.storage.local.set({ 
                        weavingError: errorData.message || 'Free tier limit exceeded. Upgrade to Pro for unlimited bookmarks.'
                    });
                }
                return;
            }

            if (!response.ok) {
                throw new Error(`Backend error: ${response.status}`);
            }
            
            // Polling is now handled by useEffect
        } catch (error) {
            console.error("Weaving error", error);
            setStatus('error');
        }
    }, [userId, isPremium]);

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
        // Mock mode - just mark as done
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.log('[ApplyChanges] Mock mode - simulating success');
            setStatus('done');
            return;
        }

        try {
            setStatus('weaving'); // Show progress indicator
            console.log('[ApplyChanges] Starting to apply changes...');

            // 1. Fetch structure with chrome_ids from backend
            const res = await fetch(`${BACKEND_URL}/structure/${userId}`);
            const data = await res.json();
            const { clusters: serverClusters, assignments } = data;

            if (!serverClusters?.length) {
                console.warn('[ApplyChanges] No clusters to apply');
                setStatus('done');
                return;
            }

            // 2. Create a "Link Loom" parent folder at the root of "Other Bookmarks"
            const otherBookmarksId = '2'; // Chrome's "Other Bookmarks" folder ID
            const linkLoomFolder = await chrome.bookmarks.create({
                parentId: otherBookmarksId,
                title: `Link Loom - ${new Date().toLocaleDateString()}`
            });
            console.log('[ApplyChanges] Created Link Loom folder:', linkLoomFolder.id);

            // 3. Build cluster hierarchy map and topological sort
            const clusterMap = new Map<string, { cluster: any; chromeId?: string }>();
            serverClusters.forEach((c: any) => {
                clusterMap.set(c.id, { cluster: c });
            });

            // Topological sort - parents before children
            const sortedClusters: any[] = [];
            const visited = new Set<string>();

            const visit = (clusterId: string) => {
                if (visited.has(clusterId)) return;
                const item = clusterMap.get(clusterId);
                if (!item) return;
                
                // Visit parent first
                if (item.cluster.parent_id && clusterMap.has(item.cluster.parent_id)) {
                    visit(item.cluster.parent_id);
                }
                
                visited.add(clusterId);
                sortedClusters.push(item.cluster);
            };

            serverClusters.forEach((c: any) => visit(c.id));

            // 4. Create folder hierarchy in Chrome
            for (const cluster of sortedClusters) {
                const parentChromeId = cluster.parent_id 
                    ? clusterMap.get(cluster.parent_id)?.chromeId 
                    : linkLoomFolder.id;

                try {
                    const folder = await chrome.bookmarks.create({
                        parentId: parentChromeId || linkLoomFolder.id,
                        title: cluster.name || 'Unnamed Folder'
                    });
                    clusterMap.get(cluster.id)!.chromeId = folder.id;
                    console.log(`[ApplyChanges] Created folder: ${cluster.name} (${folder.id})`);
                } catch (err) {
                    console.error(`[ApplyChanges] Failed to create folder: ${cluster.name}`, err);
                }
            }

            // 5. Move bookmarks to their assigned folders
            let movedCount = 0;
            let skippedCount = 0;

            for (const assignment of assignments) {
                const chromeId = assignment.bookmarks?.chrome_id;
                const targetFolderId = clusterMap.get(assignment.cluster_id)?.chromeId;

                if (!chromeId || !targetFolderId) {
                    skippedCount++;
                    continue;
                }

                try {
                    await chrome.bookmarks.move(chromeId, { parentId: targetFolderId });
                    movedCount++;
                } catch (err) {
                    // Bookmark may have been deleted or moved by user
                    console.warn(`[ApplyChanges] Failed to move bookmark ${chromeId}:`, err);
                    skippedCount++;
                }
            }

            console.log(`[ApplyChanges] Complete! Moved: ${movedCount}, Skipped: ${skippedCount}`);
            setStatus('done');
        } catch (error) {
            console.error('[ApplyChanges] Error:', error);
            setStatus('error');
        }
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
