import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';
import { BookmarkRootTitle } from '../lib/bookmarkImport';
import {
    BookmarkStats,
    StructureAssignment,
    collectDuplicateChromeIds,
    countDuplicateAssignments,
    normalizeBookmarkUrl,
    pruneBookmarksFromTree,
} from '../lib/bookmarkStructure';
import {
    BackupClient,
    deleteStructureVersion as deleteStoredStructureVersion,
    loadStructureVersions as loadStoredStructureVersions,
    saveStructureVersion as saveStoredStructureVersion,
} from '../lib/backupClient';
import { StructureClient, WeavingProgress } from '../lib/structureClient';
import { buildStructurePreview } from '../lib/structurePreviewBuilder';
import { applyChromeBookmarkPlan } from '../lib/chromeApplyPlan';
import {
    buildBookmarkRootSnapshot,
    clearPersistedOverflowBookmarks,
    collectScannedBookmarks,
    createEmptyProgress,
    loadPersistedOverflowBookmarks,
    persistOverflowBookmarks,
    savePreOrganizeBackup,
    ScannedBookmark,
} from '../lib/processingSession';

export type { BookmarkBackupSnapshot, BookmarkStructureVersion } from '../lib/backupClient';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const BACKEND_UNAVAILABLE_MESSAGE = BACKEND_URL
    ? `Cannot reach Link Loom backend at ${BACKEND_URL}. Please try again later.`
    : 'Link Loom backend is not configured. Please reinstall the extension.';
const DEAD_LINK_SCAN_REQUEST_TIMEOUT_MS = 45000;
const AUTO_RENAME_REQUEST_TIMEOUT_MS = 120000;
const STRUCTURE_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_FREE_TIER_LIMIT = 500;
const DEFAULT_ROOT_TITLE: BookmarkRootTitle = 'Other Bookmarks';
export type AppStatus = 'idle' | 'weaving' | 'ready' | 'done' | 'error' | 'limit_exceeded';
export type WeavingPhase = 'backup' | 'ingest' | null;

export type LimitExceededInfo = {
    total: number;
    limit: number;
};

const isFailedFetchError = (error: unknown) =>
    error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch');

const isAbortError = (error: unknown) =>
    error instanceof DOMException && error.name === 'AbortError';

export const useBookmarkWeaver = (
    accountUserId?: string | null,
    clusteringSettings?: ClusteringSettings,
    authAccessToken?: string | null,
    ensureAnonymousSession?: () => Promise<{ user: { id: string; email?: string | null; isAnonymous?: boolean }; accessToken: string }>,
    canSaveAccountBackups = Boolean(accountUserId)
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
    const authAccessTokenRef = useRef<string | null>(authAccessToken ?? null);

    const [isPremium, setIsPremium] = useState(false);
    const effectiveClusteringSettings = normalizeClusteringSettings(clusteringSettings);

    useEffect(() => {
        authAccessTokenRef.current = authAccessToken ?? null;
    }, [authAccessToken]);

    const getAuthHeaders = useCallback((): Record<string, string> => {
        const token = authAccessTokenRef.current || authAccessToken;
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [authAccessToken]);

    const ensureProcessingIdentity = useCallback(async () => {
        if (userId && authAccessToken) {
            return { userId, accessToken: authAccessToken };
        }
        if (accountUserId && authAccessToken) {
            setUserId(accountUserId);
            return { userId: accountUserId, accessToken: authAccessToken };
        }
        if (!ensureAnonymousSession) {
            if (userId) return { userId, accessToken: '' };
            throw new Error('Start a Link Loom session before organizing bookmarks.');
        }

        const session = await ensureAnonymousSession();
        authAccessTokenRef.current = session.accessToken;
        setUserId(session.user.id);
        return { userId: session.user.id, accessToken: session.accessToken };
    }, [accountUserId, authAccessToken, ensureAnonymousSession, userId]);

    const buildAuthHeaders = useCallback((tokenOverride?: string): Record<string, string> => {
        const token = tokenOverride || authAccessTokenRef.current || authAccessToken;
        return {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };
    }, [authAccessToken]);

    const structureClient = useMemo(() => new StructureClient({
        backendUrl: BACKEND_URL,
        buildAuthHeaders,
        getAuthHeaders,
    }), [buildAuthHeaders, getAuthHeaders]);

    const backupClient = useMemo(() => new BackupClient({
        backendUrl: BACKEND_URL,
        accountUserId,
        canSaveAccountBackups,
        buildAuthHeaders,
        getAuthHeaders,
    }), [accountUserId, buildAuthHeaders, canSaveAccountBackups, getAuthHeaders]);

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
            return '';
        };

        const hydrate = async () => {
            const resolvedUserId = await resolveUserId();
            if (cancelled || !resolvedUserId) return;
            setUserId(resolvedUserId);

            try {
                const data = await structureClient.getStatus(resolvedUserId);
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
    }, [accountUserId, structureClient]);

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
                const data = await structureClient.getStatus(userId);
                
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
                    structureClient.triggerClustering(userId, effectiveClusteringSettings)
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
    }, [effectiveClusteringSettings, status, structureClient, userId]);
    const startWeaving = useCallback(async () => {
        let processingIdentity: { userId: string; accessToken: string };
        try {
            processingIdentity = await ensureProcessingIdentity();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to start Link Loom session.');
            setStatus('error');
            return;
        }

        setWeavingPhase(null);
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

        if (processingIdentity.userId) {
            await clearPersistedOverflowBookmarks(processingIdentity.userId);
        }

        // Mock for local dev
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
             console.log("Running in mock mode");
            setStatus('weaving');
            setWeavingPhase('ingest');
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

            const bookmarks = collectScannedBookmarks(tree);
            const totalBookmarks = bookmarks.length;

            if (!isPremium && totalBookmarks > DEFAULT_FREE_TIER_LIMIT) {
                pendingBookmarksRef.current = bookmarks;
                setLimitExceededInfo({
                    total: totalBookmarks,
                    limit: DEFAULT_FREE_TIER_LIMIT,
                });
                setStats({ duplicates: 0, deadLinks: 0 });
                setWeavingPhase(null);
                setStatus('limit_exceeded');
                return;
            }

            setStatus('weaving');
            setWeavingPhase('backup');

            // 1a. Save a local backup before doing anything
            await savePreOrganizeBackup(tree);
            console.log('[WEAVING] Pre-organize backup saved to chrome.storage.local');

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
            const response = await structureClient.ingest({
                bookmarks,
                clusteringSettings: effectiveClusteringSettings,
                accessToken: processingIdentity.accessToken,
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
    }, [effectiveClusteringSettings, ensureProcessingIdentity, isPremium, structureClient]);

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
            const response = await structureClient.ingest({
                bookmarks: slicedBookmarks,
                clusteringSettings: effectiveClusteringSettings,
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
    }, [effectiveClusteringSettings, limitExceededInfo, structureClient, userId]);



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
            const response = await structureClient.scanDeadLinks(assignmentsToScan, controller.signal);

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
    }, [isPremium, structureAssignments, structureClient]);

    const fetchResults = async (idOverride?: string, silent = false) => {
        const targetId = idOverride || userId;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), STRUCTURE_REQUEST_TIMEOUT_MS);
        try {
            await ensureCurrentBookmarkTreeSnapshot();
            if (overflowBookmarksRef.current.length === 0 && targetId) {
                overflowBookmarksRef.current = await loadPersistedOverflowBookmarks(targetId);
            }

            const res = await structureClient.fetchStructure(targetId, controller.signal);
            if (!res.ok) {
                throw new Error(`Structure fetch failed: ${res.status}`);
            }
            const data = await res.json();

            const { rootNodes, assignmentSummaries, duplicateCount } = buildStructurePreview({
                data,
                availableRoots: availableRootsRef.current,
                bookmarkRootMap: bookmarkRootMapRef.current,
                bookmarkPreferredRootMap: bookmarkPreferredRootMapRef.current,
                overflowBookmarks: overflowBookmarksRef.current,
                originalTree: originalTreeRef.current,
                defaultRootTitle: DEFAULT_ROOT_TITLE,
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

            const response = await structureClient.autoRename(userId, effectiveClusteringSettings, controller.signal);

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
    }, [effectiveClusteringSettings, isPremium, structureClient, userId]);

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
        return saveStoredStructureVersion(clusters, stats);
    }, [clusters, stats]);

    const loadStructureVersions = useCallback(async () => {
        return loadStoredStructureVersions();
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
        await deleteStoredStructureVersion(versionId);
    }, []);

    const loadBookmarkBackups = useCallback(async () => {
        return backupClient.loadBookmarkBackups();
    }, [backupClient]);

    const saveCurrentBookmarkBackup = useCallback(async (customName?: string) => {
        return backupClient.saveCurrentBookmarkBackup(customName);
    }, [backupClient]);

    const deleteBookmarkBackup = useCallback(async (backupId: string) => {
        await backupClient.deleteBookmarkBackup(backupId);
    }, [backupClient]);

    const restoreBookmarkBackup = useCallback(async (backupId: string) => {
        await backupClient.restoreBookmarkBackup(backupId);
        if (accountUserId) {
            await fetchResults(accountUserId);
        }
    }, [accountUserId, backupClient, fetchResults]);

    const applyChanges = async () => {
        // Mock mode - just mark as done
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.log('[ApplyChanges] Mock mode - simulating success');
            setStatus('done');
            return;
        }

        try {
            const confirmed = window.confirm(
                accountUserId && canSaveAccountBackups
                    ? 'Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. A backup snapshot will be created first. Continue?'
                    : 'Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. Create a free account to save cloud backups first. Continue without backup?'
            );
            if (!confirmed) return;

            setStatus('weaving'); // Show progress indicator
            console.log('[ApplyChanges] Starting to apply changes...');

            // 0. Save a local snapshot backup before any changes (logged-in users only).
            if (accountUserId && canSaveAccountBackups) {
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

            const applyResult = await applyChromeBookmarkPlan(rootNodes);

            if (applyResult.shouldWarnAboutPartialApply) {
                window.alert(
                    'Link Loom applied the structure, but some bookmarks could not be moved. Existing folders were left in place to avoid deleting anything unexpectedly.'
                );
            }

            if (userId) {
                await clearPersistedOverflowBookmarks(userId);
            }
            overflowBookmarksRef.current = [];

            console.log(
                `[ApplyChanges] Complete! Moved: ${applyResult.movedCount}, Skipped: ${applyResult.skippedCount}, Folder failures: ${applyResult.folderCreateFailures}`
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
            await structureClient.cancel(userId);
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
