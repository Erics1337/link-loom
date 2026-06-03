import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import {
    ClusteringSettings,
    normalizeClusteringSettings
} from '../lib/clusteringSettings';
import { BookmarkStats, StructureAssignment } from '../lib/bookmarkStructure';
import { CloudSnapshotClient } from '../lib/backupClient';
import { StructureClient, WeavingProgress } from '../lib/structureClient';
import { createEmptyProgress } from '../lib/processingSession';
import { useBookmarkPersistence } from './useBookmarkBackups';
import { useBookmarkScanSession } from './useBookmarkScanSession';
import { useBookmarkTools } from './useBookmarkTools';
import { useChromeApply } from './useChromeApply';
import { useStructureResults } from './useStructureResults';
import { useWeaveRun } from './useWeaveRun';
import {
    AppStatus,
    BACKEND_URL,
    LimitExceededInfo,
    WeavingPhase
} from './useBookmarkWeaverTypes';

export type {
    CloudSnapshot,
    BookmarkStructureVersion
} from '../lib/backupClient';

export type { AppStatus, LimitExceededInfo, WeavingPhase } from './useBookmarkWeaverTypes';

export const useBookmarkWeaver = (
    accountUserId?: string | null,
    clusteringSettings?: ClusteringSettings,
    authAccessToken?: string | null,
    ensureAnonymousSession?: () => Promise<{
        user: { id: string; email?: string | null; isAnonymous?: boolean };
        accessToken: string;
    }>,
    canSaveCloudSnapshots = Boolean(accountUserId)
) => {
    const [status, setStatus] = useState<AppStatus>('idle');
    const [hasCachedResults, setHasCachedResults] = useState(false);
    const [weavingPhase, setWeavingPhase] = useState<WeavingPhase>(null);
    const [limitExceededInfo, setLimitExceededInfo] =
        useState<LimitExceededInfo | null>(null);
    const [progress, setProgress] = useState<WeavingProgress>(
        createEmptyProgress()
    );
    const [userId, setUserId] = useState<string>('');
    const [clusters, setClusters] = useState<BookmarkNode[]>([]);
    const [stats, setStats] = useState<BookmarkStats>({
        duplicates: 0,
        deadLinks: 0
    });
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isAutoRenaming, setIsAutoRenaming] = useState(false);
    const [structureAssignments, setStructureAssignments] = useState<
        StructureAssignment[]
    >([]);
    const [isScanningDeadLinks, setIsScanningDeadLinks] = useState(false);
    const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);
    const [isDeletingDeadLinks, setIsDeletingDeadLinks] = useState(false);
    const [isPremium, setIsPremium] = useState(false);
    const authAccessTokenRef = useRef<string | null>(authAccessToken ?? null);
    const effectiveClusteringSettings =
        normalizeClusteringSettings(clusteringSettings);

    const scanSession = useBookmarkScanSession();

    const resetRunState = useCallback(() => {
        setErrorMessage(null);
        setStructureAssignments([]);
        setProgress(createEmptyProgress());
        setIsScanningDeadLinks(false);
        setIsDeletingDuplicates(false);
        setIsDeletingDeadLinks(false);
        scanSession.resetRunRefs();
    }, [scanSession]);

    useEffect(() => {
        authAccessTokenRef.current = authAccessToken ?? null;
    }, [authAccessToken]);

    const getAuthHeaders = useCallback((): Record<string, string> => {
        const token = authAccessTokenRef.current || authAccessToken;
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [authAccessToken]);

    const buildAuthHeaders = useCallback(
        (tokenOverride?: string): Record<string, string> => {
            const token =
                tokenOverride || authAccessTokenRef.current || authAccessToken;
            return {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            };
        },
        [authAccessToken]
    );

    const structureClient = useMemo(
        () =>
            new StructureClient({
                backendUrl: BACKEND_URL,
                buildAuthHeaders,
                getAuthHeaders
            }),
        [buildAuthHeaders, getAuthHeaders]
    );

    const cloudSnapshotClient = useMemo(
        () =>
            new CloudSnapshotClient({
                backendUrl: BACKEND_URL,
                accountUserId,
                canSaveCloudSnapshots,
                buildAuthHeaders,
                getAuthHeaders
            }),
        [accountUserId, buildAuthHeaders, canSaveCloudSnapshots, getAuthHeaders]
    );

    const { fetchResults } = useStructureResults({
        userId,
        structureClient,
        ensureCurrentBookmarkTreeSnapshot:
            scanSession.ensureCurrentBookmarkTreeSnapshot,
        overflowBookmarksRef: scanSession.overflowBookmarksRef,
        availableRootsRef: scanSession.availableRootsRef,
        bookmarkRootMapRef: scanSession.bookmarkRootMapRef,
        bookmarkPreferredRootMapRef: scanSession.bookmarkPreferredRootMapRef,
        originalTreeRef: scanSession.originalTreeRef,
        deadLinkChromeIdsRef: scanSession.deadLinkChromeIdsRef,
        setClusters,
        setStructureAssignments,
        setStats,
        setHasCachedResults,
        setStatus,
        setErrorMessage
    });

    const {
        startWeaving,
        continueWithLimitedBookmarks,
        cancelWeaving
    } = useWeaveRun({
        accountUserId,
        authAccessToken,
        ensureAnonymousSession,
        userId,
        isPremium,
        status,
        limitExceededInfo,
        effectiveClusteringSettings,
        structureClient,
        authAccessTokenRef,
        pendingBookmarksRef: scanSession.pendingBookmarksRef,
        overflowBookmarksRef: scanSession.overflowBookmarksRef,
        clusterRecoveryTriggered: scanSession.clusterRecoveryTriggered,
        loadCurrentBookmarkTreeSnapshot:
            scanSession.loadCurrentBookmarkTreeSnapshot,
        resetRunState,
        fetchResults,
        setStatus,
        setHasCachedResults,
        setWeavingPhase,
        setLimitExceededInfo,
        setProgress,
        setUserId,
        setClusters,
        setStats,
        setErrorMessage,
        setIsPremium
    });

    const {
        autoRenameBookmarks,
        scanDeadLinks,
        deleteAllDuplicates,
        deleteAllDeadLinks
    } = useBookmarkTools({
        userId,
        isPremium,
        effectiveClusteringSettings,
        structureClient,
        structureAssignments,
        deadLinkChromeIdsRef: scanSession.deadLinkChromeIdsRef,
        deadLinkScanTokenRef: scanSession.deadLinkScanTokenRef,
        isDeletingDuplicates,
        isDeletingDeadLinks,
        fetchResults,
        setClusters,
        setStructureAssignments,
        setStats,
        setErrorMessage,
        setIsAutoRenaming,
        setIsScanningDeadLinks,
        setIsDeletingDuplicates,
        setIsDeletingDeadLinks
    });

    const {
        saveStructureVersion,
        loadStructureVersions,
        restoreStructureVersion,
        deleteStructureVersion,
        loadCloudSnapshots,
        saveCurrentCloudSnapshot,
        deleteCloudSnapshot,
        restoreCloudSnapshot
    } = useBookmarkPersistence({
        accountUserId,
        cloudSnapshotClient,
        clusters,
        stats,
        fetchResults,
        resetBookmarkTreeSnapshot: scanSession.resetBookmarkTreeSnapshot,
        setClusters,
        setStats,
        setStatus
    });

    const { applyChanges, applyRecovery } = useChromeApply({
        accountUserId,
        canSaveCloudSnapshots,
        userId,
        clusters,
        overflowBookmarksRef: scanSession.overflowBookmarksRef,
        clusterRecoveryTriggered: scanSession.clusterRecoveryTriggered,
        saveCurrentCloudSnapshot,
        setStatus,
        setErrorMessage
    });

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
        loadCloudSnapshots,
        saveCurrentCloudSnapshot,
        deleteCloudSnapshot,
        restoreCloudSnapshot,
        autoRenameBookmarks,
        isAutoRenaming,
        deleteAllDuplicates,
        deleteAllDeadLinks,
        scanDeadLinks,
        isDeletingDuplicates,
        isDeletingDeadLinks,
        isScanningDeadLinks,
        applyChanges,
        applyRecovery,
        setStatus,
        isPremium,
        errorMessage
    };
};
