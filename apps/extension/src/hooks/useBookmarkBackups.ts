import { Dispatch, SetStateAction, useCallback } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { BookmarkStats } from '../lib/bookmarkStructure';
import {
    BackupClient,
    deleteStructureVersion as deleteStoredStructureVersion,
    loadStructureVersions as loadStoredStructureVersions,
    saveStructureVersion as saveStoredStructureVersion
} from '../lib/backupClient';
import { AppStatus } from './useBookmarkWeaverTypes';

type UseBookmarkBackupsArgs = {
    accountUserId?: string | null;
    backupClient: BackupClient;
    clusters: BookmarkNode[];
    stats: BookmarkStats;
    fetchResults: (idOverride?: string, silent?: boolean) => Promise<void>;
    resetBookmarkTreeSnapshot: () => void;
    setClusters: Dispatch<SetStateAction<BookmarkNode[]>>;
    setStats: Dispatch<SetStateAction<BookmarkStats>>;
    setStatus: Dispatch<SetStateAction<AppStatus>>;
};

export const useBookmarkBackups = ({
    accountUserId,
    backupClient,
    clusters,
    stats,
    fetchResults,
    resetBookmarkTreeSnapshot,
    setClusters,
    setStats,
    setStatus
}: UseBookmarkBackupsArgs) => {
    const saveStructureVersion = useCallback(async () => {
        return saveStoredStructureVersion(clusters, stats);
    }, [clusters, stats]);

    const loadStructureVersions = useCallback(async () => {
        return loadStoredStructureVersions();
    }, []);

    const restoreStructureVersion = useCallback(
        async (versionId: string) => {
            const versions = await loadStructureVersions();
            const version = versions.find((item) => item.id === versionId);
            if (!version) {
                throw new Error('Selected version no longer exists.');
            }

            setClusters(
                Array.isArray(version.clusters) ? version.clusters : []
            );
            setStats(version.stats || { duplicates: 0, deadLinks: 0 });
            setStatus('ready');
            return version;
        },
        [loadStructureVersions, setClusters, setStats, setStatus]
    );

    const deleteStructureVersion = useCallback(async (versionId: string) => {
        await deleteStoredStructureVersion(versionId);
    }, []);

    const loadBookmarkBackups = useCallback(async () => {
        return backupClient.loadBookmarkBackups();
    }, [backupClient]);

    const saveCurrentBookmarkBackup = useCallback(
        async (customName?: string) => {
            return backupClient.saveCurrentBookmarkBackup(customName);
        },
        [backupClient]
    );

    const deleteBookmarkBackup = useCallback(
        async (backupId: string) => {
            await backupClient.deleteBookmarkBackup(backupId);
        },
        [backupClient]
    );

    const restoreBookmarkBackup = useCallback(
        async (backupId: string) => {
            await backupClient.restoreBookmarkBackup(backupId);
            if (accountUserId) {
                resetBookmarkTreeSnapshot();
                await fetchResults(accountUserId);
            }
        },
        [accountUserId, backupClient, fetchResults, resetBookmarkTreeSnapshot]
    );

    return {
        saveStructureVersion,
        loadStructureVersions,
        restoreStructureVersion,
        deleteStructureVersion,
        loadBookmarkBackups,
        saveCurrentBookmarkBackup,
        deleteBookmarkBackup,
        restoreBookmarkBackup
    };
};
