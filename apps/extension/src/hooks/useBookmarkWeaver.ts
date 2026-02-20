import { useState, useEffect, useCallback, useRef } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';

const BACKEND_URL = 'http://localhost:3333';
const BACKEND_UNAVAILABLE_MESSAGE = `Cannot reach Link Loom backend at ${BACKEND_URL}. Start the backend dev server and try again.`;
const DEAD_LINK_SCAN_REQUEST_TIMEOUT_MS = 60000;
const AUTO_RENAME_REQUEST_TIMEOUT_MS = 120000;
const STRUCTURE_REQUEST_TIMEOUT_MS = 45000;
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

type StructureAssignment = {
    bookmarkId: string;
    chromeId: string;
    url: string;
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

const countDuplicateAssignments = (assignments: StructureAssignment[]) => {
    const urlCounts = new Map<string, number>();
    assignments.forEach((assignment) => {
        const key = normalizeBookmarkUrl(assignment.url);
        urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
    });
    return Array.from(urlCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
};

const collectDuplicateChromeIds = (assignments: StructureAssignment[]) => {
    const chromeIdsByUrl = new Map<string, string[]>();
    assignments.forEach((assignment) => {
        const key = normalizeBookmarkUrl(assignment.url);
        const existing = chromeIdsByUrl.get(key);
        if (existing) {
            existing.push(assignment.chromeId);
        } else {
            chromeIdsByUrl.set(key, [assignment.chromeId]);
        }
    });

    const duplicateChromeIds: string[] = [];
    chromeIdsByUrl.forEach((ids) => {
        if (ids.length > 1) {
            duplicateChromeIds.push(...ids.slice(1));
        }
    });

    return duplicateChromeIds;
};

const pruneBookmarksFromTree = (nodes: BookmarkNode[], bookmarkIdsToRemove: Set<string>): BookmarkNode[] => {
    const nextNodes: BookmarkNode[] = [];

    nodes.forEach((node) => {
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        if (!hasChildren) {
            if (!bookmarkIdsToRemove.has(node.id)) {
                nextNodes.push(node);
            }
            return;
        }

        const nextChildren = pruneBookmarksFromTree(node.children!, bookmarkIdsToRemove);
        if (nextChildren.length === 0) {
            return;
        }

        nextNodes.push({ ...node, children: nextChildren });
    });

    return nextNodes;
};

const isFailedFetchError = (error: unknown) =>
    error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch');

const isAbortError = (error: unknown) =>
    error instanceof DOMException && error.name === 'AbortError';

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
    const [isAutoRenaming, setIsAutoRenaming] = useState(false);
    const [structureAssignments, setStructureAssignments] = useState<StructureAssignment[]>([]);
    const [isScanningDeadLinks, setIsScanningDeadLinks] = useState(false);
    const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);
    const [isDeletingDeadLinks, setIsDeletingDeadLinks] = useState(false);
    const clusterRecoveryTriggered = useRef(false);
    const deadLinkChromeIdsRef = useRef<string[]>([]);
    const deadLinkScanTokenRef = useRef(0);

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
                    !data.isIngesting &&
                    !data.isClusteringActive &&
                    (data.clusters === 0 || (data.remainingToAssign ?? 0) > 0)
                ) {
                    clusterRecoveryTriggered.current = true;
                    fetch(`${BACKEND_URL}/trigger-clustering/${userId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ clusteringSettings: effectiveClusteringSettings })
                    })
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
    }, [effectiveClusteringSettings, status, userId]);
    const startWeaving = useCallback(async () => {
        setStatus('weaving');
        setErrorMessage(null);
        setClusters([]); // Reset clusters to avoid showing old results
        setStructureAssignments([]);
        setProgress(createEmptyProgress()); // Reset progress
        setIsScanningDeadLinks(false);
        setIsDeletingDuplicates(false);
        setIsDeletingDeadLinks(false);
        deadLinkChromeIdsRef.current = [];
        deadLinkScanTokenRef.current += 1;
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

    const updateStateAfterBookmarkRemoval = useCallback((removedChromeIds: Set<string>) => {
        if (removedChromeIds.size === 0) return;
        deadLinkScanTokenRef.current += 1;

        const removedBookmarkIds = new Set(
            structureAssignments
                .filter((assignment) => removedChromeIds.has(assignment.chromeId))
                .map((assignment) => assignment.bookmarkId)
        );

        if (removedBookmarkIds.size > 0) {
            setClusters((prev) => pruneBookmarksFromTree(prev, removedBookmarkIds));
        }

        const nextAssignments = structureAssignments.filter((assignment) => !removedChromeIds.has(assignment.chromeId));
        setStructureAssignments(nextAssignments);

        deadLinkChromeIdsRef.current = deadLinkChromeIdsRef.current.filter((chromeId) => !removedChromeIds.has(chromeId));
        const deadChromeIdSet = new Set(deadLinkChromeIdsRef.current);
        setStats({
            duplicates: countDuplicateAssignments(nextAssignments),
            deadLinks: nextAssignments.reduce(
                (sum, assignment) => sum + (deadChromeIdSet.has(assignment.chromeId) ? 1 : 0),
                0
            )
        });
    }, [structureAssignments]);

    const scanDeadLinks = useCallback(async (assignmentsOverride?: StructureAssignment[]) => {
        const assignmentsToScan = assignmentsOverride ?? structureAssignments;
        const scanToken = deadLinkScanTokenRef.current + 1;
        deadLinkScanTokenRef.current = scanToken;

        if (assignmentsToScan.length === 0) {
            deadLinkChromeIdsRef.current = [];
            setStats((prev) => ({ ...prev, deadLinks: 0 }));
            return [] as string[];
        }

        setIsScanningDeadLinks(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEAD_LINK_SCAN_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${BACKEND_URL}/dead-links/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    bookmarks: assignmentsToScan.map((assignment) => ({
                        chromeId: assignment.chromeId,
                        url: assignment.url
                    }))
                })
            });

            if (!response.ok) {
                throw new Error(`Dead-link scan failed: ${response.status}`);
            }

            const payload = await response.json();
            const deadChromeIds = Array.isArray(payload.deadChromeIds)
                ? payload.deadChromeIds.filter((id: unknown): id is string => typeof id === 'string')
                : [];
            if (deadLinkScanTokenRef.current !== scanToken) {
                return [] as string[];
            }
            deadLinkChromeIdsRef.current = Array.from(new Set(deadChromeIds));

            const deadChromeIdSet = new Set(deadLinkChromeIdsRef.current);
            setStats((prev) => ({
                ...prev,
                deadLinks: assignmentsToScan.reduce(
                    (sum, assignment) => sum + (deadChromeIdSet.has(assignment.chromeId) ? 1 : 0),
                    0
                )
            }));

            return deadLinkChromeIdsRef.current;
        } catch (error) {
            if (deadLinkScanTokenRef.current === scanToken) {
                deadLinkChromeIdsRef.current = [];
                setStats((prev) => ({ ...prev, deadLinks: 0 }));
            }

            const isExpectedConnectivityIssue =
                isFailedFetchError(error) || (error instanceof DOMException && error.name === 'AbortError');

            if (!isExpectedConnectivityIssue) {
                console.error('[DEAD_LINKS] Failed to scan dead links', error);
            }

            return [] as string[];
        } finally {
            clearTimeout(timeoutId);
            if (deadLinkScanTokenRef.current === scanToken) {
                setIsScanningDeadLinks(false);
            }
        }
    }, [structureAssignments]);

    const fetchResults = async (idOverride?: string) => {
        const targetId = idOverride || userId;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), STRUCTURE_REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`${BACKEND_URL}/structure/${targetId}`, { signal: controller.signal });
            if (!res.ok) {
                throw new Error(`Structure fetch failed: ${res.status}`);
            }
            const data = await res.json();

            const clusterMap = new Map<string, BookmarkNode>();
            const assignmentSummaries: StructureAssignment[] = [];
            
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
                        title: a.bookmarks.ai_title || a.bookmarks.title,
                        url: a.bookmarks.url
                    });
                }
                const rawUrl = a.bookmarks?.url;
                const chromeId = a.bookmarks?.chrome_id;
                if (typeof rawUrl === 'string' && typeof chromeId === 'string' && rawUrl && chromeId) {
                    assignmentSummaries.push({
                        bookmarkId: a.bookmark_id,
                        chromeId,
                        url: rawUrl
                    });
                }
            });
            const duplicateCount = countDuplicateAssignments(assignmentSummaries);

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
            setStructureAssignments(assignmentSummaries);
            deadLinkChromeIdsRef.current = [];
            setStats({ duplicates: duplicateCount, deadLinks: 0 });
            setStatus('ready');
            void scanDeadLinks(assignmentSummaries);
        } catch (error) {
            if (isFailedFetchError(error)) {
                console.warn('[RESULTS] Backend unreachable while loading structure.');
                setErrorMessage(BACKEND_UNAVAILABLE_MESSAGE);
            } else if (isAbortError(error)) {
                console.warn(`[RESULTS] Structure request timed out after ${STRUCTURE_REQUEST_TIMEOUT_MS}ms.`);
                setErrorMessage('Loading organized bookmark structure timed out. Try again.');
            } else {
                console.error("Fetch results error", error);
                setErrorMessage('Failed to load organized bookmark structure.');
            }
            setStatus('error');
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const autoRenameBookmarks = useCallback(async () => {
        if (!userId) return;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AUTO_RENAME_REQUEST_TIMEOUT_MS);
        try {
            setIsAutoRenaming(true);
            setErrorMessage(null);

            const response = await fetch(`${BACKEND_URL}/auto-rename/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({ clusteringSettings: effectiveClusteringSettings }),
            });

            if (!response.ok) {
                throw new Error(`Auto rename failed: ${response.status}`);
            }

            await fetchResults(userId);
        } catch (error) {
            if (isFailedFetchError(error)) {
                console.warn('[AUTO_RENAME] Backend unreachable while renaming.');
                setErrorMessage(BACKEND_UNAVAILABLE_MESSAGE);
            } else if (isAbortError(error)) {
                console.warn(`[AUTO_RENAME] Request timed out after ${AUTO_RENAME_REQUEST_TIMEOUT_MS}ms.`);
                setErrorMessage('Auto rename timed out. Try again in a moment.');
            } else {
                console.error('[AUTO_RENAME] Error:', error);
                setErrorMessage('Failed to auto rename bookmarks.');
            }
        } finally {
            clearTimeout(timeoutId);
            setIsAutoRenaming(false);
        }
    }, [effectiveClusteringSettings, userId]);

    const deleteAllDuplicates = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) return;
        if (isDeletingDuplicates || structureAssignments.length === 0) return;

        const duplicateChromeIds = collectDuplicateChromeIds(structureAssignments);
        if (duplicateChromeIds.length === 0) {
            setStats((prev) => ({ ...prev, duplicates: 0 }));
            return;
        }

        const confirmed = window.confirm(
            `Delete ${duplicateChromeIds.length} duplicate bookmark${duplicateChromeIds.length === 1 ? '' : 's'}? This cannot be undone.`
        );
        if (!confirmed) return;

        setIsDeletingDuplicates(true);
        try {
            const removedChromeIds = new Set<string>();
            for (const chromeId of duplicateChromeIds) {
                try {
                    await chrome.bookmarks.remove(chromeId);
                    removedChromeIds.add(chromeId);
                } catch (error) {
                    console.warn(`[DUPLICATES] Failed to delete bookmark ${chromeId}`, error);
                }
            }

            updateStateAfterBookmarkRemoval(removedChromeIds);
        } finally {
            setIsDeletingDuplicates(false);
        }
    }, [isDeletingDuplicates, structureAssignments, updateStateAfterBookmarkRemoval]);

    const deleteAllDeadLinks = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) return;
        if (isDeletingDeadLinks) return;

        let deadChromeIds = deadLinkChromeIdsRef.current;
        if (deadChromeIds.length === 0) {
            deadChromeIds = await scanDeadLinks();
        }

        if (deadChromeIds.length === 0) {
            setStats((prev) => ({ ...prev, deadLinks: 0 }));
            return;
        }

        const confirmed = window.confirm(
            `Delete ${deadChromeIds.length} dead link${deadChromeIds.length === 1 ? '' : 's'}? This cannot be undone.`
        );
        if (!confirmed) return;

        setIsDeletingDeadLinks(true);
        try {
            const removedChromeIds = new Set<string>();
            for (const chromeId of deadChromeIds) {
                try {
                    await chrome.bookmarks.remove(chromeId);
                    removedChromeIds.add(chromeId);
                } catch (error) {
                    console.warn(`[DEAD_LINKS] Failed to delete bookmark ${chromeId}`, error);
                }
            }

            updateStateAfterBookmarkRemoval(removedChromeIds);
        } finally {
            setIsDeletingDeadLinks(false);
        }
    }, [isDeletingDeadLinks, scanDeadLinks, updateStateAfterBookmarkRemoval]);

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
                const currentTitle = (assignment.bookmarks?.title || '').trim();
                const aiTitle = (assignment.bookmarks?.ai_title || '').trim();

                if (!chromeId || !targetFolderId) {
                    skippedCount++;
                    continue;
                }

                try {
                    if (aiTitle && aiTitle !== currentTitle) {
                        await chrome.bookmarks.update(chromeId, { title: aiTitle });
                    }
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
            setStructureAssignments([]);
            setIsScanningDeadLinks(false);
            setIsDeletingDuplicates(false);
            setIsDeletingDeadLinks(false);
            deadLinkChromeIdsRef.current = [];
            deadLinkScanTokenRef.current += 1;
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
        autoRenameBookmarks,
        isAutoRenaming,
        deleteAllDuplicates,
        deleteAllDeadLinks,
        isDeletingDuplicates,
        isDeletingDeadLinks,
        isScanningDeadLinks,
        applyChanges,
        setStatus,
        isPremium,
        errorMessage
    };
};
