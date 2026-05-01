import { useState, useEffect, useCallback, useRef } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';
import { BookmarkRootTitle, ROOT_IDS, ROOT_TITLES } from '../lib/bookmarkImport';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const BACKEND_UNAVAILABLE_MESSAGE = BACKEND_URL
    ? `Cannot reach Link Loom backend at ${BACKEND_URL}. Please try again later.`
    : 'Link Loom backend is not configured. Please reinstall the extension.';
const DEAD_LINK_SCAN_REQUEST_TIMEOUT_MS = 45000;
const AUTO_RENAME_REQUEST_TIMEOUT_MS = 120000;
const STRUCTURE_REQUEST_TIMEOUT_MS = 45000;
const STRUCTURE_VERSIONS_STORAGE_KEY = 'bookmarkStructureVersions';
const PRE_ORGANIZE_BACKUP_KEY = 'preOrganizeBackup';
const OVERFLOW_BOOKMARKS_STORAGE_KEY = 'bookmarkWeaverOverflowBookmarks';
const MAX_STRUCTURE_VERSIONS = 20;
const DEFAULT_ROOT_TITLE: BookmarkRootTitle = 'Other Bookmarks';
export type AppStatus = 'idle' | 'weaving' | 'ready' | 'done' | 'error' | 'limit_exceeded';
export type WeavingPhase = 'backup' | 'ingest' | null;

export type LimitExceededInfo = {
    total: number;
    limit: number;
};
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
    name: string;
    createdAt: string;
    summary: {
        folders: number;
        bookmarks: number;
    };
};

type StructureAssignment = {
    bookmarkId: string;
    chromeId: string;
    url: string;
    rootTitle: BookmarkRootTitle;
};

type ScannedBookmark = {
    id: string;
    url: string;
    title: string;
};

type BookmarkRootSnapshot = {
    bookmarkRoots: Record<string, BookmarkRootTitle>;
    preferredRoots: Record<string, BookmarkRootTitle>;
    availableRoots: BookmarkRootTitle[];
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

const getBookmarkChromeId = (node: BookmarkNode) => {
    if (node.chromeId) return node.chromeId;
    if (node.url) return node.id;
    return undefined;
};

const pruneBookmarksFromTree = (nodes: BookmarkNode[], bookmarkChromeIdsToRemove: Set<string>): BookmarkNode[] => {
    const nextNodes: BookmarkNode[] = [];

    nodes.forEach((node) => {
        const isContainer = node.nodeType === 'root' || node.nodeType === 'folder' || Array.isArray(node.children);
        if (!isContainer) {
            if (!bookmarkChromeIdsToRemove.has(getBookmarkChromeId(node) || node.id)) {
                nextNodes.push(node);
            }
            return;
        }

        const nextChildren = pruneBookmarksFromTree(node.children || [], bookmarkChromeIdsToRemove);
        if (nextChildren.length === 0 && node.nodeType !== 'root') {
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

const countBookmarksInTree = (nodes: BookmarkNode[]): number =>
    nodes.reduce((sum, node) => {
        if (!node.children || node.children.length === 0) {
            return sum + (node.url ? 1 : 0);
        }
        return sum + countBookmarksInTree(node.children);
    }, 0);

const summarizeStructure = (nodes: BookmarkNode[]) => {
    let folders = 0;
    let bookmarks = 0;

    const walk = (branch: BookmarkNode[]) => {
        branch.forEach((node) => {
            const isContainer = node.nodeType === 'root' || node.nodeType === 'folder' || Boolean(node.children);
            if (isContainer) {
                if (node.nodeType !== 'root') {
                    folders += 1;
                }
                if (node.children?.length) {
                    walk(node.children);
                }
            } else if (node.url) {
                bookmarks += 1;
            }
        });
    };

    walk(nodes);
    return { folders, bookmarks };
};

const isBookmarkRootTitle = (value: string): value is BookmarkRootTitle =>
    ROOT_TITLES.includes(value as BookmarkRootTitle);

const IMPORTED_FOLDER_PATTERN = /^Imported(?: \(\d+\))?$/;

const inferPreferredRootFromAncestors = (
    ancestorTitles: string[],
    actualRoot: BookmarkRootTitle
): BookmarkRootTitle => {
    const inferredRoot = ancestorTitles.find(isBookmarkRootTitle);
    if (!inferredRoot || inferredRoot === actualRoot) {
        return actualRoot;
    }

    const hasImportedAncestor = ancestorTitles.some((title) => IMPORTED_FOLDER_PATTERN.test(title));
    const isDirectImportedRoot = ancestorTitles[0] === inferredRoot;

    if (hasImportedAncestor || isDirectImportedRoot) {
        return inferredRoot;
    }

    return actualRoot;
};

const buildBookmarkRootSnapshot = (tree: any[]): BookmarkRootSnapshot => {
    const bookmarkRoots: Record<string, BookmarkRootTitle> = {};
    const preferredRoots: Record<string, BookmarkRootTitle> = {};
    const availableRoots: BookmarkRootTitle[] = [];
    const topLevelNodes = Array.isArray(tree?.[0]?.children) ? tree[0].children : [];

    topLevelNodes.forEach((node: any) => {
        const rootTitle =
            ROOT_TITLES.find((candidate) => node.id === ROOT_IDS[candidate] || node.title === candidate) ??
            (typeof node.title === 'string' && isBookmarkRootTitle(node.title) ? node.title : null);

        if (!rootTitle) {
            return;
        }

        availableRoots.push(rootTitle);

        const visit = (entry: any, ancestorTitles: string[] = []) => {
            if (entry.url) {
                bookmarkRoots[entry.id] = rootTitle;
                preferredRoots[entry.id] = inferPreferredRootFromAncestors(ancestorTitles, rootTitle);
            }
            if (Array.isArray(entry.children)) {
                const nextAncestorTitles = entry?.title ? [...ancestorTitles, String(entry.title)] : ancestorTitles;
                entry.children.forEach((child: any) =>
                    visit(child, nextAncestorTitles)
                );
            }
        };

        node.children?.forEach((child: any) => visit(child, []));
    });

    return {
        bookmarkRoots,
        preferredRoots,
        availableRoots,
    };
};

const getOverflowStorageKey = (userId: string) => `${OVERFLOW_BOOKMARKS_STORAGE_KEY}:${userId}`;

const persistOverflowBookmarks = async (userId: string, overflowBookmarks: ScannedBookmark[]) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local || !userId) return;
    await chrome.storage.local.set({ [getOverflowStorageKey(userId)]: overflowBookmarks });
};

const loadPersistedOverflowBookmarks = async (userId: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local || !userId) {
        return [] as ScannedBookmark[];
    }

    const storageResult = await chrome.storage.local.get([getOverflowStorageKey(userId)]);
    const stored = storageResult[getOverflowStorageKey(userId)];
    return Array.isArray(stored) ? (stored as ScannedBookmark[]) : [];
};

const clearPersistedOverflowBookmarks = async (userId: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local || !userId) return;
    await chrome.storage.local.remove(getOverflowStorageKey(userId));
};

const resolvePreviewRoot = (
    chromeId: string,
    availableRoots: BookmarkRootTitle[],
    actualRootMap: Record<string, BookmarkRootTitle>,
    preferredRootMap: Record<string, BookmarkRootTitle>
): BookmarkRootTitle => {
    const actualRoot = actualRootMap[chromeId] ?? DEFAULT_ROOT_TITLE;
    const preferredRoot = preferredRootMap[chromeId] ?? actualRoot;

    if (preferredRoot === 'Mobile Bookmarks' && !availableRoots.includes('Mobile Bookmarks')) {
        return 'Other Bookmarks';
    }

    return preferredRoot;
};


export const useBookmarkWeaver = (
    accountUserId?: string | null,
    clusteringSettings?: ClusteringSettings
) => {
    const [status, setStatus] = useState<AppStatus>('idle');
    const [hasCachedResults, setHasCachedResults] = useState(false);
    const [weavingPhase, setWeavingPhase] = useState<WeavingPhase>(null);
    const [limitExceededInfo, setLimitExceededInfo] = useState<LimitExceededInfo | null>(null);
    const pendingBookmarksRef = useRef<ScannedBookmark[]>([]);
    const overflowBookmarksRef = useRef<ScannedBookmark[]>([]);
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
    const originalTreeRef = useRef<any[]>([]);
    const bookmarkRootMapRef = useRef<Record<string, BookmarkRootTitle>>({});
    const bookmarkPreferredRootMapRef = useRef<Record<string, BookmarkRootTitle>>({});
    const availableRootsRef = useRef<BookmarkRootTitle[]>([]);

    const [isPremium, setIsPremium] = useState(false);
    const effectiveClusteringSettings = normalizeClusteringSettings(clusteringSettings);

    const loadCurrentBookmarkTreeSnapshot = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            return [] as any[];
        }

        const tree = await chrome.bookmarks.getTree();
        originalTreeRef.current = tree;
        const snapshot = buildBookmarkRootSnapshot(tree);
        bookmarkRootMapRef.current = snapshot.bookmarkRoots;
        bookmarkPreferredRootMapRef.current = snapshot.preferredRoots;
        availableRootsRef.current = snapshot.availableRoots;
        return tree;
    }, []);

    const ensureCurrentBookmarkTreeSnapshot = useCallback(async () => {
        if (
            originalTreeRef.current.length === 0 ||
            availableRootsRef.current.length === 0 ||
            Object.keys(bookmarkRootMapRef.current).length === 0
        ) {
            await loadCurrentBookmarkTreeSnapshot();
        }
    }, [loadCurrentBookmarkTreeSnapshot]);

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
                    setHasCachedResults(true);
                    await fetchResults(resolvedUserId, true);
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
        setWeavingPhase('backup');
        setErrorMessage(null);
        setClusters([]); // Reset clusters to avoid showing old results
        setHasCachedResults(false);
        setStructureAssignments([]);
        setProgress(createEmptyProgress()); // Reset progress
        setIsScanningDeadLinks(false);
        setIsDeletingDuplicates(false);
        setIsDeletingDeadLinks(false);
        deadLinkChromeIdsRef.current = [];
        deadLinkScanTokenRef.current += 1;
        clusterRecoveryTriggered.current = false;
        overflowBookmarksRef.current = []; // Clear any previous overflow
        pendingBookmarksRef.current = [];

        if (userId) {
            await clearPersistedOverflowBookmarks(userId);
        }

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
            const tree = await loadCurrentBookmarkTreeSnapshot();

            // 1a. Save a local backup before doing anything
            const backup = {
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                tree: tree,
            };
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                await chrome.storage.local.set({ [PRE_ORGANIZE_BACKUP_KEY]: backup });
                console.log('[WEAVING] Pre-organize backup saved to chrome.storage.local');
            }

            const bookmarks: ScannedBookmark[] = [];
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

            // Move to ingest phase now that backup is complete
            setWeavingPhase('ingest');
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
                console.warn('[WEAVING] Limit exceeded:', errorData);
                // Store the bookmarks so we can retry with a slice
                pendingBookmarksRef.current = bookmarks;
                setLimitExceededInfo({
                    total: bookmarks.length,
                    limit: errorData.limit ?? 500,
                });
                setStats({ duplicates: 0, deadLinks: 0 });
                setWeavingPhase(null);
                setStatus('limit_exceeded');
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

    const continueWithLimitedBookmarks = useCallback(async () => {
        const limit = limitExceededInfo?.limit ?? 500;
        const allBookmarks = pendingBookmarksRef.current;
        const slicedBookmarks = allBookmarks.slice(0, limit);
        // Store the remaining bookmarks so they appear in the result preview
        overflowBookmarksRef.current = allBookmarks.slice(limit);
        if (userId) {
            await persistOverflowBookmarks(userId, overflowBookmarksRef.current);
        }
        pendingBookmarksRef.current = [];
        setLimitExceededInfo(null);
        setStatus('weaving');
        setWeavingPhase('ingest');
        setErrorMessage(null);
        setProgress(prev => ({
            ...prev,
            total: slicedBookmarks.length,
            pending: slicedBookmarks.length,
            pendingRaw: slicedBookmarks.length,
            processing: slicedBookmarks.length,
            remainingToAssign: slicedBookmarks.length,
            isIngesting: true,
            ingestProcessed: 0,
            ingestTotal: slicedBookmarks.length
        }));

        try {
            const response = await fetch(`${BACKEND_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, bookmarks: slicedBookmarks, clusteringSettings: effectiveClusteringSettings }),
            });

            if (response.status === 402) {
                const errorData = await response.json().catch(() => ({}));
                // Snap back to limit_exceeded so the user still sees the banner
                pendingBookmarksRef.current = slicedBookmarks;
                overflowBookmarksRef.current = [];
                setLimitExceededInfo({
                    total: slicedBookmarks.length,
                    limit: errorData.limit ?? 500,
                });
                setWeavingPhase(null);
                setStatus('limit_exceeded');
                return;
            }

            if (!response.ok) {
                throw new Error(`Backend error: ${response.status}`);
            }
            // Polling takes over from here
        } catch (error) {
            const message = isFailedFetchError(error)
                ? BACKEND_UNAVAILABLE_MESSAGE
                : error instanceof Error
                    ? error.message
                    : 'Something went wrong while organizing bookmarks.';
            setErrorMessage(message);
            setStatus('error');
        }
    }, [effectiveClusteringSettings, limitExceededInfo, userId]);



    const updateStateAfterBookmarkRemoval = useCallback((removedChromeIds: Set<string>) => {
        if (removedChromeIds.size === 0) return;
        deadLinkScanTokenRef.current += 1;

        const nextAssignments = structureAssignments.filter((assignment) => !removedChromeIds.has(assignment.chromeId));
        setClusters((prev) => pruneBookmarksFromTree(prev, removedChromeIds));
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
        if (!isPremium) {
            setErrorMessage('Dead-link scanning requires Link Loom Pro.');
            return [] as string[];
        }

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
                    userId,
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
    }, [isPremium, structureAssignments, userId]);

    const fetchResults = async (idOverride?: string, silent = false) => {
        const targetId = idOverride || userId;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), STRUCTURE_REQUEST_TIMEOUT_MS);
        try {
            await ensureCurrentBookmarkTreeSnapshot();
            if (overflowBookmarksRef.current.length === 0 && targetId) {
                overflowBookmarksRef.current = await loadPersistedOverflowBookmarks(targetId);
            }

            const res = await fetch(`${BACKEND_URL}/structure/${targetId}`, { signal: controller.signal });
            if (!res.ok) {
                throw new Error(`Structure fetch failed: ${res.status}`);
            }
            const data = await res.json();

            const clusterDefinitions = new Map<string, { id: string; name: string; parentId: string | null }>();
            const childClusterIds = new Map<string | null, string[]>();
            const assignmentSummaries: StructureAssignment[] = [];
            const bookmarksByRootAndCluster = new Map<BookmarkRootTitle, Map<string, BookmarkNode[]>>();
            const availableRoots = availableRootsRef.current;

            data.clusters.forEach((cluster: any) => {
                clusterDefinitions.set(cluster.id, {
                    id: cluster.id,
                    name: cluster.name,
                    parentId: cluster.parent_id ?? null,
                });
                const parentKey = cluster.parent_id ?? null;
                const siblings = childClusterIds.get(parentKey);
                if (siblings) {
                    siblings.push(cluster.id);
                } else {
                    childClusterIds.set(parentKey, [cluster.id]);
                }
            });

            data.assignments.forEach((a: any) => {
                const rawUrl = a.bookmarks?.url;
                const chromeId = a.bookmarks?.chrome_id;
                if (typeof rawUrl === 'string' && typeof chromeId === 'string' && rawUrl && chromeId) {
                    const rootTitle = resolvePreviewRoot(
                        chromeId,
                        availableRoots,
                        bookmarkRootMapRef.current,
                        bookmarkPreferredRootMapRef.current
                    );
                    assignmentSummaries.push({
                        bookmarkId: a.bookmark_id,
                        chromeId,
                        url: rawUrl,
                        rootTitle,
                    });

                    const rootAssignments = bookmarksByRootAndCluster.get(rootTitle) ?? new Map<string, BookmarkNode[]>();
                    const clusterBookmarks = rootAssignments.get(a.cluster_id) ?? [];
                    clusterBookmarks.push({
                        id: `bookmark-${a.bookmark_id}`,
                        title: a.bookmarks.ai_title || a.bookmarks.title,
                        originalTitle: a.bookmarks.title,
                        url: rawUrl,
                        chromeId,
                        nodeType: 'bookmark',
                        rootTitle,
                    });
                    rootAssignments.set(a.cluster_id, clusterBookmarks);
                    bookmarksByRootAndCluster.set(rootTitle, rootAssignments);
                }
            });
            const duplicateCount = countDuplicateAssignments(assignmentSummaries);

            const buildClusterNodeForRoot = (clusterId: string, rootTitle: BookmarkRootTitle): BookmarkNode | null => {
                const cluster = clusterDefinitions.get(clusterId);
                if (!cluster) return null;

                const childFolders = (childClusterIds.get(clusterId) || [])
                    .map((childId) => buildClusterNodeForRoot(childId, rootTitle))
                    .filter((node): node is BookmarkNode => Boolean(node));
                const directBookmarks = bookmarksByRootAndCluster.get(rootTitle)?.get(clusterId) || [];

                if (childFolders.length === 0 && directBookmarks.length === 0) {
                    return null;
                }

                return {
                    id: `cluster-${rootTitle}-${clusterId}`,
                    title: cluster.name,
                    children: [...childFolders, ...directBookmarks],
                    parentId: cluster.parentId,
                    nodeType: 'folder',
                    rootTitle,
                };
            };

            const overflowIds = new Set(overflowBookmarksRef.current.map((bookmark) => bookmark.id));
            const buildOverflowTree = (nodes: any[]): BookmarkNode[] => {
                const result: BookmarkNode[] = [];

                for (const node of nodes) {
                    if (node.url) {
                        if (!overflowIds.has(node.id)) continue;
                        const rootTitle = bookmarkRootMapRef.current[node.id] ?? DEFAULT_ROOT_TITLE;
                        result.push({
                            id: `overflow-bookmark-${node.id}`,
                            title: node.title,
                            originalTitle: node.title,
                            url: node.url,
                            chromeId: node.id,
                            nodeType: 'bookmark',
                            rootTitle,
                            isOverflow: true,
                        });
                        continue;
                    }

                    if (!Array.isArray(node.children)) continue;

                    const filteredChildren = buildOverflowTree(node.children);
                    if (filteredChildren.length === 0) continue;

                    result.push({
                        id: `overflow-folder-${node.id}`,
                        title: node.title || 'Untitled Folder',
                        children: filteredChildren,
                        nodeType: 'folder',
                        rootTitle: typeof node.title === 'string' && isBookmarkRootTitle(node.title) ? node.title : undefined,
                        isOverflow: true,
                    });
                }

                return result;
            };

            const overflowNodes = buildOverflowTree(originalTreeRef.current?.[0]?.children || []);
            const rootNodes: BookmarkNode[] = [];
            const overflowCount = overflowBookmarksRef.current.length;

            ROOT_TITLES.forEach((rootTitle) => {
                const clusterChildren = (childClusterIds.get(null) || [])
                    .map((clusterId) => buildClusterNodeForRoot(clusterId, rootTitle))
                    .filter((node): node is BookmarkNode => Boolean(node));
                const rootChildren = [...clusterChildren];

                if (rootTitle === 'Other Bookmarks' && overflowNodes.length > 0) {
                    rootChildren.push({
                        id: 'overflow-unorganized-folder',
                        title: 'Unorganized Bookmarks',
                        children: overflowNodes,
                        nodeType: 'folder',
                        rootTitle,
                        isOverflow: true,
                        badgeLabel: 'Unorganized',
                    });
                }

                if (rootChildren.length === 0 && !availableRoots.includes(rootTitle)) {
                    return;
                }

                rootNodes.push({
                    id: `root-${rootTitle}`,
                    title: rootTitle,
                    children: rootChildren,
                    nodeType: 'root',
                    rootTitle,
                    badgeLabel:
                        rootTitle === 'Other Bookmarks' && overflowCount > 0
                            ? `${overflowCount} extra`
                            : undefined,
                });
            });

            setClusters(rootNodes);
            setStructureAssignments(assignmentSummaries);
            deadLinkChromeIdsRef.current = [];
            setStats({ duplicates: duplicateCount, deadLinks: 0 });
            setHasCachedResults(rootNodes.length > 0);
            if (!silent) {
                setStatus('ready');
            }
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
            if (!silent) {
                setStatus('error');
            } else {
                setHasCachedResults(false);
            }
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const autoRenameBookmarks = useCallback(async () => {
        if (!userId) return;
        if (!isPremium) {
            setErrorMessage('Auto rename requires Link Loom Pro.');
            return;
        }

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
    }, [effectiveClusteringSettings, isPremium, userId]);

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

        const deadChromeIds = deadLinkChromeIdsRef.current;
        if (deadChromeIds.length === 0) {
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
    }, [isDeletingDeadLinks, updateStateAfterBookmarkRemoval]);

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
        try {
            const res = await fetch(`${BACKEND_URL}/backups/${accountUserId}`);
            if (!res.ok) throw new Error('Failed to load structure backups');
            const data = await res.json();
            return data.backups as BookmarkBackupSnapshot[];
        } catch (err) {
            console.error('[BACKUPS] Fetch error:', err);
            return [] as BookmarkBackupSnapshot[];
        }
    }, [accountUserId]);

    const saveCurrentBookmarkBackup = useCallback(async (customName?: string) => {
        if (!accountUserId) throw new Error('You need to log in to save backups.');
        
        const name = customName || `Snapshot ${new Date().toLocaleDateString()}`;
        const res = await fetch(`${BACKEND_URL}/backups/${accountUserId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save structure snapshot');
        }
        
        // Return a dummy object just to please TS if it's pushed to local state temporarily
        return {
            id: 'just_created',
            name: name,
            createdAt: new Date().toISOString(),
            summary: { folders: 0, bookmarks: 0 }
        } as BookmarkBackupSnapshot;
    }, [accountUserId]);

    const deleteBookmarkBackup = useCallback(async (backupId: string) => {
        if (!accountUserId) throw new Error('You need to log in to manage backups.');
        
        const res = await fetch(`${BACKEND_URL}/backups/${accountUserId}/${backupId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) throw new Error('Failed to delete structure snapshot');
    }, [accountUserId]);

    const restoreBookmarkBackup = useCallback(async (backupId: string) => {
        if (!accountUserId) throw new Error('You need to log in to restore backups.');
        
        const res = await fetch(`${BACKEND_URL}/backups/${accountUserId}/${backupId}/restore`, {
            method: 'POST'
        });
        
        if (!res.ok) throw new Error('Failed to restore structure snapshot');
        
        // Automatically fetch the restored structured results 
        await fetchResults(accountUserId);
    }, [accountUserId, fetchResults]);

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
                    ? 'Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. A backup snapshot will be created first. Continue?'
                    : 'Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. Log in to enable automatic backups. Continue without backup?'
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

            const rootNodes = clusters.filter(
                (node): node is BookmarkNode & { rootTitle: BookmarkRootTitle } =>
                    node.nodeType === 'root' && Boolean(node.rootTitle)
            );

            if (rootNodes.length === 0) {
                console.warn('[ApplyChanges] No root-aware structure is available to apply');
                setStatus('done');
                return;
            }

            let movedCount = 0;
            let skippedCount = 0;
            let folderCreateFailures = 0;
            const createdFolderIds = new Map<string, string>();
            const keepIdsByRoot = new Map<BookmarkRootTitle, Set<string>>();

            const createFoldersForNodes = async (
                nodes: BookmarkNode[],
                parentId: string,
                rootKeepIds: Set<string>,
                isTopLevel = false
            ) => {
                for (const node of nodes) {
                    if (node.url) continue;

                    try {
                        const folder = await chrome.bookmarks.create({
                            parentId,
                            title: node.title || 'Untitled Folder',
                        });
                        createdFolderIds.set(node.id, folder.id);
                        if (isTopLevel) {
                            rootKeepIds.add(folder.id);
                        }
                        await createFoldersForNodes(node.children || [], folder.id, rootKeepIds);
                    } catch (error) {
                        folderCreateFailures += 1;
                        console.error(`[ApplyChanges] Failed to create folder ${node.title}`, error);
                    }
                }
            };

            const applyBookmarksForNodes = async (
                nodes: BookmarkNode[],
                parentId: string,
                rootKeepIds: Set<string>,
                isTopLevel = false
            ) => {
                for (const node of nodes) {
                    if (node.url) {
                        const chromeId = getBookmarkChromeId(node);
                        if (!chromeId) {
                            skippedCount += 1;
                            continue;
                        }

                        try {
                            const nextTitle = node.title.trim();
                            const currentTitle = (node.originalTitle || node.title).trim();
                            if (nextTitle && nextTitle !== currentTitle) {
                                await chrome.bookmarks.update(chromeId, { title: node.title });
                            }
                            await chrome.bookmarks.move(chromeId, { parentId });
                            if (isTopLevel) {
                                rootKeepIds.add(chromeId);
                            }
                            movedCount += 1;
                        } catch (error) {
                            console.warn(`[ApplyChanges] Failed to move bookmark ${chromeId}:`, error);
                            skippedCount += 1;
                        }
                        continue;
                    }

                    const folderId = createdFolderIds.get(node.id);
                    if (!folderId) {
                        skippedCount += countBookmarksInTree(node.children || []);
                        continue;
                    }

                    await applyBookmarksForNodes(node.children || [], folderId, rootKeepIds);
                }
            };

            const clearRootChildrenExcept = async (rootId: string, keepIds: Set<string>) => {
                const children = await chrome.bookmarks.getChildren(rootId);
                for (const child of [...children].reverse()) {
                    if (keepIds.has(child.id)) continue;
                    if (child.url) {
                        await chrome.bookmarks.remove(child.id);
                    } else {
                        await chrome.bookmarks.removeTree(child.id);
                    }
                }
            };

            for (const rootNode of rootNodes) {
                const rootId = ROOT_IDS[rootNode.rootTitle];
                const keepIds = new Set<string>();
                keepIdsByRoot.set(rootNode.rootTitle, keepIds);
                await createFoldersForNodes(rootNode.children || [], rootId, keepIds, true);
            }

            for (const rootNode of rootNodes) {
                const rootId = ROOT_IDS[rootNode.rootTitle];
                const keepIds = keepIdsByRoot.get(rootNode.rootTitle) || new Set<string>();
                await applyBookmarksForNodes(rootNode.children || [], rootId, keepIds, true);
            }

            if (folderCreateFailures === 0 && skippedCount === 0) {
                for (const rootNode of rootNodes) {
                    await clearRootChildrenExcept(
                        ROOT_IDS[rootNode.rootTitle],
                        keepIdsByRoot.get(rootNode.rootTitle) || new Set<string>()
                    );
                }
            } else {
                window.alert(
                    'Link Loom applied the structure, but some bookmarks could not be moved. Existing folders were left in place to avoid deleting anything unexpectedly.'
                );
            }

            if (userId) {
                await clearPersistedOverflowBookmarks(userId);
            }
            overflowBookmarksRef.current = [];

            console.log(
                `[ApplyChanges] Complete! Moved: ${movedCount}, Skipped: ${skippedCount}, Folder failures: ${folderCreateFailures}`
            );
            clusterRecoveryTriggered.current = false;
            setErrorMessage(null);
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
            await clearPersistedOverflowBookmarks(userId);
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
            overflowBookmarksRef.current = [];
            pendingBookmarksRef.current = [];
        }
    };

    return {
        hasCachedResults,
        resumeWeavingSession: () => setStatus('ready'),
        status,
        weavingPhase,
        limitExceededInfo,
        continueWithLimitedBookmarks,
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
        scanDeadLinks,
        isDeletingDuplicates,
        isDeletingDeadLinks,
        isScanningDeadLinks,
        applyChanges,
        setStatus,
        isPremium,
        errorMessage
    };
};
