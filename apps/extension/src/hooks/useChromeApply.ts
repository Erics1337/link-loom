import {
    Dispatch,
    MutableRefObject,
    SetStateAction,
    useCallback,
    useEffect,
    useState
} from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { BookmarkRootTitle } from '../lib/bookmarkImport';
import {
    applyChromeBookmarkPlan,
    buildChromeBookmarkApplyPlan,
    clearChromeApplyJournal,
    ChromeApplyJournal,
    formatChromeApplyPlanPreview,
    loadActiveChromeApplyJournal,
    resumeChromeBookmarkApplyJournal,
    rollbackChromeBookmarkApplyJournal
} from '../lib/chromeApplyPlan';
import {
    clearPersistedOverflowBookmarks,
    ScannedBookmark
} from '../lib/processingSession';
import {
    AppStatus,
    BACKEND_UNAVAILABLE_MESSAGE,
    isFailedFetchError
} from './useBookmarkWeaverTypes';

type UseChromeApplyArgs = {
    accountUserId?: string | null;
    canSaveCloudSnapshots: boolean;
    userId: string;
    clusters: BookmarkNode[];
    overflowBookmarksRef: MutableRefObject<ScannedBookmark[]>;
    clusterRecoveryTriggered: MutableRefObject<boolean>;
    saveCurrentCloudSnapshot: () => Promise<unknown>;
    setStatus: Dispatch<SetStateAction<AppStatus>>;
    setErrorMessage: Dispatch<SetStateAction<string | null>>;
};

export type ChromeApplyRecoveryState = {
    activeJournal: ChromeApplyJournal | null;
    isLoading: boolean;
    isResolving: boolean;
    message: {
        kind: 'success' | 'error';
        text: string;
    } | null;
    refresh: () => Promise<void>;
    resume: () => Promise<void>;
    rollback: () => Promise<void>;
};

export const useChromeApply = ({
    accountUserId,
    canSaveCloudSnapshots,
    userId,
    clusters,
    overflowBookmarksRef,
    clusterRecoveryTriggered,
    saveCurrentCloudSnapshot,
    setStatus,
    setErrorMessage
}: UseChromeApplyArgs) => {
    const [activeJournal, setActiveJournal] =
        useState<ChromeApplyJournal | null>(null);
    const [isLoadingJournal, setIsLoadingJournal] = useState(false);
    const [isResolvingJournal, setIsResolvingJournal] = useState(false);
    const [recoveryMessage, setRecoveryMessage] = useState<{
        kind: 'success' | 'error';
        text: string;
    } | null>(null);

    const refreshActiveJournal = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            setActiveJournal(null);
            return;
        }

        setIsLoadingJournal(true);
        try {
            setActiveJournal(await loadActiveChromeApplyJournal());
        } finally {
            setIsLoadingJournal(false);
        }
    }, []);

    useEffect(() => {
        void refreshActiveJournal();
    }, [refreshActiveJournal]);

    const getRecoveredStatus = useCallback(
        () => (clusters.length > 0 ? 'ready' : 'idle'),
        [clusters.length]
    );

    const resumeActiveJournal = useCallback(async () => {
        const journal = activeJournal || (await loadActiveChromeApplyJournal());
        if (!journal) {
            setRecoveryMessage(null);
            setActiveJournal(null);
            return;
        }

        setIsResolvingJournal(true);
        setRecoveryMessage(null);
        setStatus('weaving');
        try {
            const resumeResult = await resumeChromeBookmarkApplyJournal(journal);
            if (resumeResult.shouldWarnAboutPartialApply) {
                setActiveJournal(await loadActiveChromeApplyJournal());
                setRecoveryMessage({
                    kind: 'error',
                    text: 'Resume ran, but some bookmark operations still could not be completed. The journal is still available.'
                });
                setStatus(getRecoveredStatus());
            } else {
                setActiveJournal(null);
                setRecoveryMessage({
                    kind: 'success',
                    text: 'Recovered and finished the unfinished bookmark apply.'
                });
                setStatus('done');
            }
        } catch (error) {
            console.error('[ApplyRecovery] Resume failed:', error);
            setActiveJournal(await loadActiveChromeApplyJournal());
            setRecoveryMessage({
                kind: 'error',
                text:
                    error instanceof Error
                        ? error.message
                        : 'Failed to resume the unfinished bookmark apply.'
            });
            setStatus(getRecoveredStatus());
        } finally {
            setIsResolvingJournal(false);
        }
    }, [activeJournal, getRecoveredStatus, setStatus]);

    const rollbackActiveJournal = useCallback(async () => {
        const journal = activeJournal || (await loadActiveChromeApplyJournal());
        if (!journal) {
            setRecoveryMessage(null);
            setActiveJournal(null);
            return;
        }

        const confirmed = window.confirm(
            'Roll back the unfinished bookmark apply? Link Loom will undo the recorded changes from this journal. This cannot restore deleted folder contents unless a Cloud Snapshot has them.'
        );
        if (!confirmed) return;

        setIsResolvingJournal(true);
        setRecoveryMessage(null);
        setStatus('weaving');
        try {
            const rollbackResult =
                await rollbackChromeBookmarkApplyJournal(journal);
            setActiveJournal(null);
            setRecoveryMessage({
                kind:
                    rollbackResult.skippedDeletedFolderCount > 0
                        ? 'error'
                        : 'success',
                text:
                    rollbackResult.skippedDeletedFolderCount > 0
                        ? `Rolled back the journal, but ${rollbackResult.skippedDeletedFolderCount} deleted folder${rollbackResult.skippedDeletedFolderCount === 1 ? '' : 's'} need a Cloud Snapshot restore to recover nested contents.`
                        : 'Rolled back the unfinished bookmark apply.'
            });
            setStatus(getRecoveredStatus());
        } catch (error) {
            console.error('[ApplyRecovery] Rollback failed:', error);
            setActiveJournal(await loadActiveChromeApplyJournal());
            setRecoveryMessage({
                kind: 'error',
                text:
                    error instanceof Error
                        ? error.message
                        : 'Failed to roll back the unfinished bookmark apply.'
            });
            setStatus(getRecoveredStatus());
        } finally {
            setIsResolvingJournal(false);
        }
    }, [activeJournal, getRecoveredStatus, setStatus]);

    const applyChanges = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.log('[ApplyChanges] Mock mode - simulating success');
            setStatus('done');
            return;
        }

        try {
            const fetchedActiveJournal = await loadActiveChromeApplyJournal();
            if (fetchedActiveJournal) {
                setActiveJournal(fetchedActiveJournal);
                setRecoveryMessage({
                    kind: 'error',
                    text: 'Resolve the unfinished apply journal before starting a new apply.'
                });
                setStatus('ready');
                return;
            }

            const rootNodes = clusters.filter(
                (
                    node
                ): node is BookmarkNode & { rootTitle: BookmarkRootTitle } =>
                    node.nodeType === 'root' && Boolean(node.rootTitle)
            );

            if (rootNodes.length === 0) {
                console.warn(
                    '[ApplyChanges] No root-aware structure is available to apply'
                );
                setStatus('done');
                return;
            }

            const applyPlan = await buildChromeBookmarkApplyPlan(rootNodes);
            const planPreview = formatChromeApplyPlanPreview(applyPlan);
            const confirmed = window.confirm(
                accountUserId && canSaveCloudSnapshots
                    ? `Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. A Cloud Snapshot will be created first.

${planPreview}

Continue?`
                    : `Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. Sign in to save Cloud Snapshots first.

${planPreview}

Continue without a Cloud Snapshot?`
            );
            if (!confirmed) return;

            setStatus('weaving');
            console.log('[ApplyChanges] Starting to apply changes...');

            if (accountUserId && canSaveCloudSnapshots) {
                await saveCurrentCloudSnapshot();
                console.log('[ApplyChanges] Saved Cloud Snapshot');
            } else {
                console.log(
                    '[ApplyChanges] Skipped Cloud Snapshot because user is not logged in'
                );
            }

            const applyResult = await applyChromeBookmarkPlan(applyPlan);

            if (applyResult.shouldWarnAboutPartialApply) {
                setActiveJournal(await loadActiveChromeApplyJournal());
                setRecoveryMessage({
                    kind: 'error',
                    text: 'Some bookmark operations could not be completed. The local apply journal is available to resume or roll back.'
                });
            } else {
                await clearChromeApplyJournal();
                setActiveJournal(null);
                setRecoveryMessage(null);
            }

            if (userId) {
                await clearPersistedOverflowBookmarks(userId);
            }
            overflowBookmarksRef.current = [];

            console.log(
                `[ApplyChanges] Complete! Created folders: ${applyResult.createdFolderCount}, Moved: ${applyResult.movedCount}, Renamed: ${applyResult.renamedCount}, Deleted: ${applyResult.deletedCount}, Skipped: ${applyResult.skippedCount}, Folder failures: ${applyResult.folderCreateFailures}`
            );
            clusterRecoveryTriggered.current = false;
            setErrorMessage(null);
            setStatus(
                applyResult.shouldWarnAboutPartialApply ? 'ready' : 'done'
            );
        } catch (error) {
            const journalAfterError = await loadActiveChromeApplyJournal();
            if (journalAfterError) {
                setActiveJournal(journalAfterError);
                setRecoveryMessage({
                    kind: 'error',
                    text:
                        error instanceof Error
                            ? error.message
                            : 'Failed to apply changes. The local apply journal is available to resume or roll back.'
                });
                setErrorMessage(null);
                setStatus(getRecoveredStatus());
                return;
            }

            if (isFailedFetchError(error)) {
                console.warn(
                    '[ApplyChanges] Backend unreachable while applying changes.'
                );
                setErrorMessage(BACKEND_UNAVAILABLE_MESSAGE);
            } else {
                console.error('[ApplyChanges] Error:', error);
                setErrorMessage('Failed to apply changes to Chrome bookmarks.');
            }
            setStatus('error');
        }
    }, [
        accountUserId,
        canSaveCloudSnapshots,
        clusterRecoveryTriggered,
        clusters,
        getRecoveredStatus,
        overflowBookmarksRef,
        saveCurrentCloudSnapshot,
        setErrorMessage,
        setStatus,
        userId
    ]);

    return {
        applyChanges,
        applyRecovery: {
            activeJournal,
            isLoading: isLoadingJournal,
            isResolving: isResolvingJournal,
            message: recoveryMessage,
            refresh: refreshActiveJournal,
            resume: resumeActiveJournal,
            rollback: rollbackActiveJournal
        } satisfies ChromeApplyRecoveryState
    };
};
