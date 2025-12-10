import { useState, useEffect, useCallback } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';

const BACKEND_URL = 'http://localhost:3333';

export type AppStatus = 'idle' | 'weaving' | 'ready' | 'done' | 'error';

export const useBookmarkWeaver = () => {
    const [status, setStatus] = useState<AppStatus>('idle');
    const [progress, setProgress] = useState({ pending: 0, clusters: 0, total: 0 });
    const [userId, setUserId] = useState<string>('');
    const [clusters, setClusters] = useState<BookmarkNode[]>([]);
    const [stats, setStats] = useState({ duplicates: 0, deadLinks: 0 });

    useEffect(() => {
        chrome.storage.local.get(['userId'], (result) => {
            if (result.userId) {
                setUserId(result.userId as string);
            } else {
                const newId = crypto.randomUUID();
                chrome.storage.local.set({ userId: newId });
                setUserId(newId);
            }
        });
    }, []);

    const startWeaving = useCallback(async () => {
        setStatus('weaving');

        // Mock for local dev
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.log("Running in mock mode");
            setTimeout(() => {
                setProgress({ pending: 50, clusters: 5, total: 100 });
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

            // 3. Poll Status
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(`${BACKEND_URL}/status/${userId}`);
                    const data = await res.json();
                    console.log('[POLL] Status response:', data);
                    setProgress(prev => ({ 
                        ...prev, 
                        pending: data.pending, 
                        clusters: data.clusters,
                        total: data.total || prev.total  // Use backend total if available
                    }));

                    if (data.isDone) {
                        clearInterval(interval);
                        await fetchResults();
                    }
                } catch (e) {
                    console.error("Polling error", e);
                }
            }, 2000);
        } catch (error) {
            console.error("Weaving error", error);
            setStatus('error');
        }
    }, [userId]);

    const fetchResults = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/structure/${userId}`);
            const data = await res.json();

            // Transform backend data to BookmarkNode[]
            // Assuming data.clusters is the structure we want
            // For now, let's mock the transformation or assume backend returns compatible tree
            // We'll map it to our UI structure

            const transformedClusters: BookmarkNode[] = data.clusters.map((c: any) => ({
                id: c.id,
                title: c.name,
                children: c.items?.map((item: any) => ({
                    id: item.id,
                    title: item.title,
                    url: item.url
                })) || []
            }));

            setClusters(transformedClusters);
            setStats({ duplicates: 7, deadLinks: 0 }); // Mock stats for now
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

    return {
        status,
        progress,
        clusters,
        stats,
        startWeaving,
        applyChanges,
        setStatus
    };
};
