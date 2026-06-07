import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import { BookmarkNode } from '../components/BookmarkTree';
import { BookmarkStats, StructureAssignment } from '../lib/bookmarkStructure';
import {
    CloudSnapshotClient,
    deleteStructureVersion as deleteStoredStructureVersion,
    loadStructureVersions as loadStoredStructureVersions,
    saveStructureVersion as saveStoredStructureVersion
} from '../lib/backupClient';
import { AppStatus } from './useBookmarkWeaverTypes';

type UseBookmarkPersistenceArgs = {
    accountUserId?: string | null;
    cloudSnapshotClient: CloudSnapshotClient;
    clusters: BookmarkNode[];
    stats: BookmarkStats;
    fetchResults: (idOverride?: string, silent?: boolean) => Promise<void>;
    resetBookmarkTreeSnapshot: () => void;
    setClusters: Dispatch<SetStateAction<BookmarkNode[]>>;
    setStats: Dispatch<SetStateAction<BookmarkStats>>;
    setStatus: Dispatch<SetStateAction<AppStatus>>;
    setStructureAssignments: Dispatch<SetStateAction<StructureAssignment[]>>;
    deadLinkChromeIdsRef: MutableRefObject<string[]>;
};

export const useBookmarkPersistence = ({
    accountUserId,
    cloudSnapshotClient,
    clusters,
    stats,
    fetchResults,
    resetBookmarkTreeSnapshot,
    setClusters,
    setStats,
    setStatus,
    setStructureAssignments,
    deadLinkChromeIdsRef
}: UseBookmarkPersistenceArgs) => {
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
            setStructureAssignments([]);
            deadLinkChromeIdsRef.current = [];
            setStatus('ready');
            return version;
        },
        [loadStructureVersions, setClusters, setStats, setStructureAssignments, deadLinkChromeIdsRef, setStatus]
    );

    const deleteStructureVersion = useCallback(async (versionId: string) => {
        await deleteStoredStructureVersion(versionId);
    }, []);

    const loadCloudSnapshots = useCallback(async () => {
        return cloudSnapshotClient.loadCloudSnapshots();
    }, [cloudSnapshotClient]);

    const saveCurrentCloudSnapshot = useCallback(
        async (customName?: string) => {
            return cloudSnapshotClient.saveCurrentCloudSnapshot(customName);
        },
        [cloudSnapshotClient]
    );

    const deleteCloudSnapshot = useCallback(
        async (snapshotId: string) => {
            await cloudSnapshotClient.deleteCloudSnapshot(snapshotId);
        },
        [cloudSnapshotClient]
    );

    const restoreCloudSnapshot = useCallback(
        async (snapshotId: string) => {
            await cloudSnapshotClient.restoreCloudSnapshot(snapshotId);
            if (accountUserId) {
                resetBookmarkTreeSnapshot();
                await fetchResults(accountUserId);
            }
        },
        [
            accountUserId,
            cloudSnapshotClient,
            fetchResults,
            resetBookmarkTreeSnapshot
        ]
    );

    return {
        saveStructureVersion,
        loadStructureVersions,
        restoreStructureVersion,
        deleteStructureVersion,
        loadCloudSnapshots,
        saveCurrentCloudSnapshot,
        deleteCloudSnapshot,
        restoreCloudSnapshot
    };
};
