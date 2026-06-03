import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { ClusteringSettings } from '../lib/clusteringSettings';
import {
    BookmarkStats,
    StructureAssignment,
    collectDuplicateChromeIds,
    countDuplicateAssignments,
    pruneBookmarksFromTree
} from '../lib/bookmarkStructure';
import { StructureClient } from '../lib/structureClient';
import {
    AUTO_RENAME_REQUEST_TIMEOUT_MS,
    BACKEND_UNAVAILABLE_MESSAGE,
    DEAD_LINK_SCAN_REQUEST_TIMEOUT_MS,
    isAbortError,
    isFailedFetchError
} from './useBookmarkWeaverTypes';

type UseBookmarkToolsArgs = {
    userId: string;
    isPremium: boolean;
    effectiveClusteringSettings: ClusteringSettings;
    structureClient: StructureClient;
    structureAssignments: StructureAssignment[];
    deadLinkChromeIdsRef: MutableRefObject<string[]>;
    deadLinkScanTokenRef: MutableRefObject<number>;
    isDeletingDuplicates: boolean;
    isDeletingDeadLinks: boolean;
    fetchResults: (idOverride?: string, silent?: boolean) => Promise<void>;
    setClusters: Dispatch<SetStateAction<BookmarkNode[]>>;
    setStructureAssignments: Dispatch<SetStateAction<StructureAssignment[]>>;
    setStats: Dispatch<SetStateAction<BookmarkStats>>;
    setErrorMessage: Dispatch<SetStateAction<string | null>>;
    setIsAutoRenaming: Dispatch<SetStateAction<boolean>>;
    setIsScanningDeadLinks: Dispatch<SetStateAction<boolean>>;
    setIsDeletingDuplicates: Dispatch<SetStateAction<boolean>>;
    setIsDeletingDeadLinks: Dispatch<SetStateAction<boolean>>;
};

export const useBookmarkTools = ({
    userId,
    isPremium,
    effectiveClusteringSettings,
    structureClient,
    structureAssignments,
    deadLinkChromeIdsRef,
    deadLinkScanTokenRef,
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
}: UseBookmarkToolsArgs) => {
    const updateStateAfterBookmarkRemoval = useCallback(
        (removedChromeIds: Set<string>) => {
            if (removedChromeIds.size === 0) return;
            deadLinkScanTokenRef.current += 1;

            setClusters((prev) =>
                pruneBookmarksFromTree(prev, removedChromeIds)
            );

            deadLinkChromeIdsRef.current = deadLinkChromeIdsRef.current.filter(
                (chromeId) => !removedChromeIds.has(chromeId)
            );
            const deadChromeIdSet = new Set(deadLinkChromeIdsRef.current);

            setStructureAssignments((prev) => {
                const nextAssignments = prev.filter(
                    (assignment) => !removedChromeIds.has(assignment.chromeId)
                );
                setStats({
                    duplicates: countDuplicateAssignments(nextAssignments),
                    deadLinks: nextAssignments.reduce(
                        (sum, assignment) =>
                            sum +
                            (deadChromeIdSet.has(assignment.chromeId) ? 1 : 0),
                        0
                    )
                });
                return nextAssignments;
            });
        },
        [
            deadLinkChromeIdsRef,
            deadLinkScanTokenRef,
            setClusters,
            setStats,
            setStructureAssignments
        ]
    );

    const scanDeadLinks = useCallback(
        async (assignmentsOverride?: StructureAssignment[]) => {
            if (!isPremium) {
                setErrorMessage('Dead-link scanning requires Link Loom Pro.');
                return [] as string[];
            }

            const assignmentsToScan =
                assignmentsOverride ?? structureAssignments;
            const scanToken = deadLinkScanTokenRef.current + 1;
            deadLinkScanTokenRef.current = scanToken;

            if (assignmentsToScan.length === 0) {
                deadLinkChromeIdsRef.current = [];
                setStats((prev) => ({ ...prev, deadLinks: 0 }));
                return [] as string[];
            }

            setIsScanningDeadLinks(true);
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                DEAD_LINK_SCAN_REQUEST_TIMEOUT_MS
            );
            try {
                const response = await structureClient.scanDeadLinks(
                    assignmentsToScan,
                    controller.signal
                );

                if (!response.ok) {
                    throw new Error(
                        `Dead-link scan failed: ${response.status}`
                    );
                }

                const payload = await response.json();
                const deadChromeIds = Array.isArray(payload.deadChromeIds)
                    ? payload.deadChromeIds.filter(
                          (id: unknown): id is string => typeof id === 'string'
                      )
                    : [];
                if (deadLinkScanTokenRef.current !== scanToken) {
                    return [] as string[];
                }
                deadLinkChromeIdsRef.current = Array.from(
                    new Set(deadChromeIds)
                );

                const deadChromeIdSet = new Set(deadLinkChromeIdsRef.current);
                setStats((prev) => ({
                    ...prev,
                    deadLinks: assignmentsToScan.reduce(
                        (sum, assignment) =>
                            sum +
                            (deadChromeIdSet.has(assignment.chromeId) ? 1 : 0),
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
                    isFailedFetchError(error) ||
                    (error instanceof DOMException &&
                        error.name === 'AbortError');

                if (!isExpectedConnectivityIssue) {
                    console.error(
                        '[DEAD_LINKS] Failed to scan dead links',
                        error
                    );
                }

                return [] as string[];
            } finally {
                clearTimeout(timeoutId);
                if (deadLinkScanTokenRef.current === scanToken) {
                    setIsScanningDeadLinks(false);
                }
            }
        },
        [
            deadLinkChromeIdsRef,
            deadLinkScanTokenRef,
            isPremium,
            setErrorMessage,
            setIsScanningDeadLinks,
            setStats,
            structureAssignments,
            structureClient
        ]
    );

    const autoRenameBookmarks = useCallback(async () => {
        if (!userId) return;
        if (!isPremium) {
            setErrorMessage('Auto rename requires Link Loom Pro.');
            return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            AUTO_RENAME_REQUEST_TIMEOUT_MS
        );
        try {
            setIsAutoRenaming(true);
            setErrorMessage(null);

            const response = await structureClient.autoRename(
                userId,
                effectiveClusteringSettings,
                controller.signal
            );

            if (!response.ok) {
                throw new Error(`Auto rename failed: ${response.status}`);
            }

            await fetchResults(userId);
        } catch (error) {
            if (isFailedFetchError(error)) {
                console.warn(
                    '[AUTO_RENAME] Backend unreachable while renaming.'
                );
                setErrorMessage(BACKEND_UNAVAILABLE_MESSAGE);
            } else if (isAbortError(error)) {
                console.warn(
                    `[AUTO_RENAME] Request timed out after ${AUTO_RENAME_REQUEST_TIMEOUT_MS}ms.`
                );
                setErrorMessage(
                    'Auto rename timed out. Try again in a moment.'
                );
            } else {
                console.error('[AUTO_RENAME] Error:', error);
                setErrorMessage('Failed to auto rename bookmarks.');
            }
        } finally {
            clearTimeout(timeoutId);
            setIsAutoRenaming(false);
        }
    }, [
        effectiveClusteringSettings,
        fetchResults,
        isPremium,
        setErrorMessage,
        setIsAutoRenaming,
        structureClient,
        userId
    ]);

    const deleteAllDuplicates = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) return;
        if (isDeletingDuplicates || structureAssignments.length === 0) return;

        const duplicateChromeIds =
            collectDuplicateChromeIds(structureAssignments);
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
                    console.warn(
                        `[DUPLICATES] Failed to delete bookmark ${chromeId}`,
                        error
                    );
                }
            }

            updateStateAfterBookmarkRemoval(removedChromeIds);
        } finally {
            setIsDeletingDuplicates(false);
        }
    }, [
        isDeletingDuplicates,
        setIsDeletingDuplicates,
        setStats,
        structureAssignments,
        updateStateAfterBookmarkRemoval
    ]);

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
                    console.warn(
                        `[DEAD_LINKS] Failed to delete bookmark ${chromeId}`,
                        error
                    );
                }
            }

            updateStateAfterBookmarkRemoval(removedChromeIds);
        } finally {
            setIsDeletingDeadLinks(false);
        }
    }, [
        deadLinkChromeIdsRef,
        isDeletingDeadLinks,
        setIsDeletingDeadLinks,
        updateStateAfterBookmarkRemoval
    ]);

    return {
        autoRenameBookmarks,
        scanDeadLinks,
        deleteAllDuplicates,
        deleteAllDeadLinks
    };
};
