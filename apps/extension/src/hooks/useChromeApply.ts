import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { BookmarkRootTitle } from '../lib/bookmarkImport';
import {
    applyChromeBookmarkPlan,
    buildChromeBookmarkApplyPlan,
    clearChromeApplyJournal,
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
    canSaveAccountBackups: boolean;
    userId: string;
    clusters: BookmarkNode[];
    overflowBookmarksRef: MutableRefObject<ScannedBookmark[]>;
    clusterRecoveryTriggered: MutableRefObject<boolean>;
    saveCurrentBookmarkBackup: () => Promise<unknown>;
    setStatus: Dispatch<SetStateAction<AppStatus>>;
    setErrorMessage: Dispatch<SetStateAction<string | null>>;
};

export const useChromeApply = ({
    accountUserId,
    canSaveAccountBackups,
    userId,
    clusters,
    overflowBookmarksRef,
    clusterRecoveryTriggered,
    saveCurrentBookmarkBackup,
    setStatus,
    setErrorMessage
}: UseChromeApplyArgs) => {
    const applyChanges = useCallback(async () => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.log('[ApplyChanges] Mock mode - simulating success');
            setStatus('done');
            return;
        }

        try {
            const activeJournal = await loadActiveChromeApplyJournal();
            if (activeJournal) {
                const shouldResume = window.confirm(
                    'Link Loom found an unfinished bookmark apply from an earlier run. Resume it now? Choose Cancel to roll back the recorded changes instead.'
                );
                if (shouldResume) {
                    const resumeResult =
                        await resumeChromeBookmarkApplyJournal(activeJournal);
                    if (resumeResult.shouldWarnAboutPartialApply) {
                        window.alert(
                            'Link Loom resumed the apply, but some operations still could not be completed. The local apply journal was kept so you can try again or roll it back.'
                        );
                        setStatus('ready');
                    } else {
                        setStatus('done');
                    }
                    return;
                }

                const rollbackResult =
                    await rollbackChromeBookmarkApplyJournal(activeJournal);
                if (rollbackResult.skippedDeletedFolderCount > 0) {
                    window.alert(
                        `Link Loom rolled back the unfinished bookmark apply journal, but ${rollbackResult.skippedDeletedFolderCount} deleted folder${rollbackResult.skippedDeletedFolderCount === 1 ? '' : 's'} need a backup restore to recover nested contents.`
                    );
                } else {
                    window.alert(
                        'Link Loom rolled back the unfinished bookmark apply journal.'
                    );
                }
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
                accountUserId && canSaveAccountBackups
                    ? `Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. A backup snapshot will be created first.

${planPreview}

Continue?`
                    : `Apply changes will rewrite the displayed structure directly inside your Chrome bookmark folders. Create a free account to save cloud backups first.

${planPreview}

Continue without backup?`
            );
            if (!confirmed) return;

            setStatus('weaving');
            console.log('[ApplyChanges] Starting to apply changes...');

            if (accountUserId && canSaveAccountBackups) {
                await saveCurrentBookmarkBackup();
                console.log('[ApplyChanges] Saved bookmark backup snapshot');
            } else {
                console.log(
                    '[ApplyChanges] Skipped backup snapshot because user is not logged in'
                );
            }

            const applyResult = await applyChromeBookmarkPlan(applyPlan);

            if (applyResult.shouldWarnAboutPartialApply) {
                window.alert(
                    'Link Loom applied the structure, but some operations could not be completed. A local apply journal was kept so the next apply can resume or roll back safely.'
                );
            } else {
                await clearChromeApplyJournal();
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
        canSaveAccountBackups,
        clusterRecoveryTriggered,
        clusters,
        overflowBookmarksRef,
        saveCurrentBookmarkBackup,
        setErrorMessage,
        setStatus,
        userId
    ]);

    return { applyChanges };
};
