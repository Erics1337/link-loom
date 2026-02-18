import { useState, useEffect, useCallback, useRef } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';

const BACKEND_URL = 'http://localhost:3333';
const BACKEND_UNAVAILABLE_MESSAGE = `Cannot reach Link Loom backend at ${BACKEND_URL}. Start the backend dev server and try again.`;
const STRUCTURE_VERSIONS_STORAGE_KEY = 'bookmarkStructureVersions';
const MAX_STRUCTURE_VERSIONS = 20;
const MAX_BOOKMARK_BACKUPS = 10;

export type AppStatus = 'idle' | 'weaving' | 'ready' | 'done' | 'error';
type BookmarkStats = { duplicates: number; deadLinks: number };

export type BookmarkStructureVersion = {
    id: string;
    createdAt: string;
    clusters: BookmarkNode[];
    stats: BookmarkStats;
    summary: {
        folders: number;
        bookmarks: number;
    };
};

export type BookmarkBackupSnapshot = {
    id: string;
    createdAt: string;
    tree: chrome.bookmarks.BookmarkTreeNode[];
    summary: {
        folders: number;
        bookmarks: number;
    };
};

const normalizeBookmarkUrl = (url: string) => {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        if (parsed.pathname.endsWith('/')) {
            parsed.pathname = parsed.pathname.slice(0, -1);
        }
        return parsed.toString();
    } catch {
        return url.trim();
    }
};

const isFailedFetchError = (error: unknown) =>
    error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch');

type WeavingProgress = {
    pending: number;
    pendingRaw: number;
    enriched: number;
    embedded: number;
    errored: number;
    processing: number;
    remainingToAssign: number;
    clusters: number;
    assigned: number;
    total: number;
    isIngesting: boolean;
    ingestProcessed: number;
    ingestTotal: number;
    isClusteringActive: boolean;
};

const createEmptyProgress = (): WeavingProgress => ({
    pending: 0,
    pendingRaw: 0,
    enriched: 0,
    embedded: 0,
    errored: 0,
    processing: 0,
    remainingToAssign: 0,
    clusters: 0,
    assigned: 0,
    total: 0,
    isIngesting: false,
    ingestProcessed: 0,
    ingestTotal: 0,
    isClusteringActive: false
});

const summarizeStructure = (nodes: BookmarkNode[]) => {
    let folders = 0;
    let bookmarks = 0;

    const walk = (branch: BookmarkNode[]) => {
        branch.forEach((node) => {
            const hasChildren = Boolean(node.children?.length);
            if (hasChildren) {
                folders += 1;
                walk(node.children!);
            } else if (node.url) {
                bookmarks += 1;
            }
        });
    };

    walk(nodes);
    return { folders, bookmarks };
};

const getBookmarkBackupStorageKey = (accountUserId: string) => `bookmarkBackups:${accountUserId}`;

const summarizeBookmarkTree = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
    let folders = 0;
    let bookmarks = 0;

    const walk = (branch: chrome.bookmarks.BookmarkTreeNode[]) => {
        branch.forEach((node) => {
            if (node.url) {
                bookmarks += 1;
                return;
            }

            folders += 1;
            if (Array.isArray(node.children) && node.children.length > 0) {
                walk(node.children);
            }
        });
    };

    walk(nodes);
    return { folders, bookmarks };
};

const cloneBookmarkTree = (tree: chrome.bookmarks.BookmarkTreeNode[]) =>
    JSON.parse(JSON.stringify(tree)) as chrome.bookmarks.BookmarkTreeNode[];

export const useBookmarkWeaver = (
    accountUserId?: string | null,
    clusteringSettings?: ClusteringSettings
) => {
    const [status, setStatus] = useState<AppStatus>('idle');
    const [progress, setProgress] = useState<WeavingProgress>(createEmptyProgress());
    const [userId, setUserId] = useState<string>('');
    const [clusters, setClusters] = useState<BookmarkNode[]>([]);
    const [stats, setStats] = useState<BookmarkStats>({ duplicates: 0, deadLinks: 0 });
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const clusterRecoveryTriggered = useRef(false);

    const [isPremium, setIsPremium] = useState(false);
    const effectiveClusteringSettings = normalizeClusteringSettings(clusteringSettings);

    useEffect(() => {
        let cancelled = false;

        const resolveUserId = async () => {
            if (accountUserId) return accountUserId;
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return crypto.randomUUID();

            const result = await chrome.storage.local.get(['userId']);
            let currentUserId = result.userId as string | undefined;
            if (!currentUserId) {
                currentUserId = crypto.randomUUID();
                await chrome.storage.local.set({ userId: currentUserId });
            }
            return currentUserId;
        };

        const hydrate = async () => {
            const resolvedUserId = await resolveUserId();
            if (cancelled || !resolvedUserId) return;
            setUserId(resolvedUserId);

            try {
                const res = await fetch(`${BACKEND_URL}/status/${resolvedUserId}`);
                const data = await res.json();
                if (cancelled) return;

                if (data.isPremium) setIsPremium(true);
                else setIsPremium(false);

                if (data.pending > 0 || (data.total > 0 && !data.isDone)) {
                    setStatus('weaving');
                    setProgress({
                        pending: data.pending,
                        pendingRaw: data.pendingRaw ?? data.pending ?? 0,
                        enriched: data.enriched ?? 0,
                        embedded: data.embedded ?? 0,
                        errored: data.errored ?? 0,
                        processing: data.processing ?? data.pending ?? 0,
                        remainingToAssign: data.remainingToAssign ?? 0,
                        clusters: data.clusters,
                        assigned: data.assigned || 0,
                        total: data.total,
                        isIngesting: Boolean(data.isIngesting),
                        ingestProcessed: data.ingestProcessed || 0,
                        ingestTotal: data.ingestTotal || data.total || 0,
                        isClusteringActive: Boolean(data.isClusteringActive)
                    });
                } else if (data.isDone) {
                    setStatus('ready');
                    await fetchResults(resolvedUserId);
                }
            } catch (e) {
                if (isFailedFetchError(e)) {
                    console.warn('[STATUS] Backend not reachable during initial status check.');
                    return;
                }
                console.error("Failed to check initial status", e);
            }
        };

        hydrate();
        return () => {
            cancelled = true;
        };
    }, [accountUserId]);

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
                    pendingRaw: data.pendingRaw ?? data.pending ?? 0,
                    enriched: data.enriched ?? 0,
                    embedded: data.embedded ?? 0,
                    errored: data.errored ?? 0,
                    processing: data.processing ?? data.pending ?? 0,
                    remainingToAssign: data.remainingToAssign ?? 0,
                    clusters: data.clusters,
                    assigned: data.assigned || 0,
                    // Use backend total if available, otherwise keep existing
                    total: data.total || prev.total,
                    isIngesting: Boolean(data.isIngesting),
                    ingestProcessed: data.ingestProcessed || 0,
                    ingestTotal: data.ingestTotal || data.total || prev.total,
                    isClusteringActive: Boolean(data.isClusteringActive)
                }));

                // Recovery path: if all bookmarks are embedded but no clusters were created,
                // trigger clustering once more to avoid getting stuck at "Structuring 0 of N".
                if (
                    !clusterRecoveryTriggered.current &&
                    data.total > 0 &&
                    data.pending === 0 &&
                    data.clusters === 0 &&
                    !data.isIngesting
                ) {
                    clusterRecoveryTriggered.current = true;
                    fetch(`${BACKEND_URL}/trigger-clustering/${userId}`, { method: 'POST' })
                        .catch((err) => console.error('[WEAVING] Failed to trigger recovery clustering', err));
                }

                if (data.isDone) {
                    clearInterval(interval);
                    await fetchResults(userId);
                }
            } catch (e) {
                if (isFailedFetchError(e)) {
                    console.warn('[STATUS] Polling skipped because backend is unavailable.');
                    return;
                }
                console.error("Polling error", e);
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [status, userId]);
    const startWeaving = useCallback(async () => {
        setStatus('weaving');
        setErrorMessage(null);
        setClusters([]); // Reset clusters to avoid showing old results
        setProgress(createEmptyProgress()); // Reset progress
        clusterRecoveryTriggered.current = false;

        // Mock for local dev
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
             console.log("Running in mock mode");
            setTimeout(() => {
                setProgress({
                    pending: 50,
                    pendingRaw: 40,
                    enriched: 10,
                    embedded: 50,
                    errored: 0,
                    processing: 50,
                    remainingToAssign: 80,
                    clusters: 5,
                    assigned: 20,
                    total: 100,
                    isIngesting: false,
                    ingestProcessed: 100,
                    ingestTotal: 100,
                    isClusteringActive: true
                });
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
            setProgress(prev => ({
                ...prev,
                total: totalBookmarks,
                pending: totalBookmarks,
                pendingRaw: totalBookmarks,
                enriched: 0,
                embedded: 0,
                errored: 0,
                processing: totalBookmarks,
                remainingToAssign: totalBookmarks,
                isIngesting: true,
                ingestProcessed: 0,
                ingestTotal: totalBookmarks,
                isClusteringActive: false
            }));

            // Compute duplicate URLs for preview stats (dead-links remain server-side TODO).
            const urlCounts = new Map<string, number>();
            bookmarks.forEach((bookmark) => {
                const key = normalizeBookmarkUrl(bookmark.url);
                urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
            });
            const duplicateCount = Array.from(urlCounts.values())
                .reduce((sum, count) => sum + Math.max(0, count - 1), 0);
            setStats({ duplicates: duplicateCount, deadLinks: 0 });

            // 2. Send to Backend
            const response = await fetch(`${BACKEND_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, bookmarks, clusteringSettings: effectiveClusteringSettings }),
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
                setErrorMessage(
                    errorData.message || 'Free tier limit exceeded. Upgrade to Pro for unlimited bookmarks.'
                );
                setStatus('error');
                return;
            }

            if (!response.ok) {
                throw new Error(`Backend error: ${response.status}`);
            }
            
            // Polling is now handled by useEffect
        } catch (error) {
            const message = isFailedFetchError(error)
                ? BACKEND_UNAVAILABLE_MESSAGE
                : error instanceof Error
                    ? error.message
                    : 'Something went wrong while organizing bookmarks.';
            if (isFailedFetchError(error)) {
                console.warn('[WEAVING] Backend unreachable while starting weave.');
            } else {
                console.error("Weaving error", error);
            }
            setErrorMessage(message);
            setStatus('error');
        }
    }, [effectiveClusteringSettings, isPremium, userId]);

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

            const urlCounts = new Map<string, number>();
            data.assignments.forEach((a: any) => {
                const rawUrl = a.bookmarks?.url;
                if (!rawUrl) return;
                const key = normalizeBookmarkUrl(rawUrl);
                urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
            });
            const duplicateCount = Array.from(urlCounts.values())
                .reduce((sum, count) => sum + Math.max(0, count - 1), 0);

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
            setStats({ duplicates: duplicateCount, deadLinks: 0 });
            setStatus('ready');
        } catch (error) {
            if (isFailedFetchError(error)) {
                console.warn('[RESULTS] Backend unreachable while loading structure.');
                setErrorMessage(BACKEND_UNAVAILABLE_MESSAGE);
            } else {
                console.error("Fetch results error", error);
                setErrorMessage('Failed to load organized bookmark structure.');
            }
            setStatus('error');
        }
    };

    const saveStructureVersion = useCallback(async () => {
        if (!clusters.length) {
            throw new Error('No bookmark structure is available to save yet.');
        }

        const snapshot: BookmarkStructureVersion = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            clusters: JSON.parse(JSON.stringify(clusters)) as BookmarkNode[],
            stats: { ...stats },
            summary: summarizeStructure(clusters)
        };

        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return snapshot;
        }

        const storageResult = await chrome.storage.local.get([STRUCTURE_VERSIONS_STORAGE_KEY]);
        const existingVersions = Array.isArray(storageResult[STRUCTURE_VERSIONS_STORAGE_KEY])
            ? (storageResult[STRUCTURE_VERSIONS_STORAGE_KEY] as BookmarkStructureVersion[])
            : [];
        const nextVersions = [snapshot, ...existingVersions].slice(0, MAX_STRUCTURE_VERSIONS);
        await chrome.storage.local.set({ [STRUCTURE_VERSIONS_STORAGE_KEY]: nextVersions });
        return snapshot;
    }, [clusters, stats]);

    const loadStructureVersions = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return [] as BookmarkStructureVersion[];
        }

        const storageResult = await chrome.storage.local.get([STRUCTURE_VERSIONS_STORAGE_KEY]);
        return Array.isArray(storageResult[STRUCTURE_VERSIONS_STORAGE_KEY])
            ? (storageResult[STRUCTURE_VERSIONS_STORAGE_KEY] as BookmarkStructureVersion[])
            : [];
    }, []);

    const restoreStructureVersion = useCallback(async (versionId: string) => {
        const versions = await loadStructureVersions();
        const version = versions.find((item) => item.id === versionId);
        if (!version) {
            throw new Error('Selected version no longer exists.');
        }

        setClusters(Array.isArray(version.clusters) ? version.clusters : []);
        setStats(version.stats || { duplicates: 0, deadLinks: 0 });
        setStatus('ready');
        return version;
    }, [loadStructureVersions]);

    const deleteStructureVersion = useCallback(async (versionId: string) => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return;
        }

        const versions = await loadStructureVersions();
        const remaining = versions.filter((item) => item.id !== versionId);
        await chrome.storage.local.set({ [STRUCTURE_VERSIONS_STORAGE_KEY]: remaining });
    }, [loadStructureVersions]);

    const loadBookmarkBackups = useCallback(async () => {
        if (!accountUserId) return [] as BookmarkBackupSnapshot[];
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return [] as BookmarkBackupSnapshot[];

        const storageKey = getBookmarkBackupStorageKey(accountUserId);
        const result = await chrome.storage.local.get([storageKey]);
        return Array.isArray(result[storageKey])
            ? (result[storageKey] as BookmarkBackupSnapshot[])
            : [];
    }, [accountUserId]);

    const saveCurrentBookmarkBackup = useCallback(async () => {
        if (!accountUserId) {
            throw new Error('You need to log in to save backups.');
        }
        if (typeof chrome === 'undefined' || !chrome.bookmarks || !chrome.storage?.local) {
            throw new Error('Bookmark APIs are unavailable in this environment.');
        }

        const storageKey = getBookmarkBackupStorageKey(accountUserId);
        const currentTree = await chrome.bookmarks.getTree();
        const storageResult = await chrome.storage.local.get([storageKey]);
        const existingBackups = Array.isArray(storageResult[storageKey])
            ? (storageResult[storageKey] as BookmarkBackupSnapshot[])
            : [];

        const snapshot: BookmarkBackupSnapshot = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            tree: cloneBookmarkTree(currentTree),
            summary: summarizeBookmarkTree(currentTree)
        };

        await chrome.storage.local.set({
            [storageKey]: [snapshot, ...existingBackups].slice(0, MAX_BOOKMARK_BACKUPS)
        });
        return snapshot;
    }, [accountUserId]);

    const deleteBookmarkBackup = useCallback(async (backupId: string) => {
        if (!accountUserId) {
            throw new Error('You need to log in to manage backups.');
        }
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

        const storageKey = getBookmarkBackupStorageKey(accountUserId);
        const backups = await loadBookmarkBackups();
        const nextBackups = backups.filter((item) => item.id !== backupId);
        await chrome.storage.local.set({ [storageKey]: nextBackups });
    }, [accountUserId, loadBookmarkBackups]);

    const restoreBookmarkBackup = useCallback(async (backupId: string) => {
        if (!accountUserId) {
            throw new Error('You need to log in to restore backups.');
        }
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            throw new Error('Bookmarks API is unavailable in this environment.');
        }

        const backups = await loadBookmarkBackups();
        const snapshot = backups.find((item) => item.id === backupId);
        if (!snapshot) {
            throw new Error('Selected backup no longer exists.');
        }

        const restoreRoot = await chrome.bookmarks.create({
            parentId: '2',
            title: `Link Loom Restore - ${new Date().toLocaleDateString()}`
        });

        const recreateNode = async (node: chrome.bookmarks.BookmarkTreeNode, parentId: string): Promise<void> => {
            if (node.url) {
                await chrome.bookmarks.create({
                    parentId,
                    title: node.title || node.url,
                    url: node.url
                });
                return;
            }

            const folder = await chrome.bookmarks.create({
                parentId,
                title: node.title || 'Folder'
            });

            if (!Array.isArray(node.children)) return;
            for (const child of node.children) {
                await recreateNode(child, folder.id);
            }
        };

        for (const root of snapshot.tree || []) {
            if (root.id === '0' && Array.isArray(root.children)) {
                for (const child of root.children) {
                    await recreateNode(child, restoreRoot.id);
                }
                continue;
            }

            await recreateNode(root, restoreRoot.id);
        }
    }, [accountUserId, loadBookmarkBackups]);

    const applyChanges = async () => {
        // Mock mode - just mark as done
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.log('[ApplyChanges] Mock mode - simulating success');
            setStatus('done');
            return;
        }

        try {
            const confirmed = window.confirm(
                accountUserId
                    ? 'Apply changes will move bookmarks into a new Link Loom folder. A backup snapshot will be created first. Continue?'
                    : 'Apply changes will move bookmarks into a new Link Loom folder. Log in to enable automatic backups. Continue without backup?'
            );
            if (!confirmed) return;

            setStatus('weaving'); // Show progress indicator
            console.log('[ApplyChanges] Starting to apply changes...');

            // 0. Save a local snapshot backup before any changes (logged-in users only).
            if (accountUserId) {
                await saveCurrentBookmarkBackup();
                console.log('[ApplyChanges] Saved bookmark backup snapshot');
            } else {
                console.log('[ApplyChanges] Skipped backup snapshot because user is not logged in');
            }

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
            clusterRecoveryTriggered.current = false;
            setStatus('done');
        } catch (error) {
            if (isFailedFetchError(error)) {
                console.warn('[ApplyChanges] Backend unreachable while applying changes.');
                setErrorMessage(BACKEND_UNAVAILABLE_MESSAGE);
            } else {
                console.error('[ApplyChanges] Error:', error);
                setErrorMessage('Failed to apply changes to Chrome bookmarks.');
            }
            setStatus('error');
        }
    };

    const cancelWeaving = async () => {
        if (!userId) return;
        try {
            await fetch(`${BACKEND_URL}/cancel/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clearAllQueues: true })
            });
        } catch (error) {
            console.error("Cancel error", error);
        } finally {
            // Always reset UI state
            setStatus('idle');
            setErrorMessage(null);
            setProgress(createEmptyProgress());
            clusterRecoveryTriggered.current = false;
        }
    };

    return {
        status,
        progress,
        clusters,
        stats,
        startWeaving,
        cancelWeaving,
        saveStructureVersion,
        loadStructureVersions,
        restoreStructureVersion,
        deleteStructureVersion,
        loadBookmarkBackups,
        saveCurrentBookmarkBackup,
        deleteBookmarkBackup,
        restoreBookmarkBackup,
        applyChanges,
        setStatus,
        isPremium,
        errorMessage
    };
};
