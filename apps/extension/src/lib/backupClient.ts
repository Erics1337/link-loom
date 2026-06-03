import { BookmarkNode } from '../components/BookmarkTree';
import { BookmarkStats, summarizeStructure } from './bookmarkStructure';

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

export type CloudSnapshot = {
    id: string;
    name: string;
    createdAt: string;
    summary: {
        folders: number;
        bookmarks: number;
    };
};

const STRUCTURE_VERSIONS_STORAGE_KEY = 'bookmarkStructureVersions';
const MAX_STRUCTURE_VERSIONS = 20;

export const saveStructureVersion = async (clusters: BookmarkNode[], stats: BookmarkStats) => {
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
};

export const loadStructureVersions = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return [] as BookmarkStructureVersion[];
    }

    const storageResult = await chrome.storage.local.get([STRUCTURE_VERSIONS_STORAGE_KEY]);
    return Array.isArray(storageResult[STRUCTURE_VERSIONS_STORAGE_KEY])
        ? (storageResult[STRUCTURE_VERSIONS_STORAGE_KEY] as BookmarkStructureVersion[])
        : [];
};

export const deleteStructureVersion = async (versionId: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return;
    }

    const versions = await loadStructureVersions();
    const remaining = versions.filter((item) => item.id !== versionId);
    await chrome.storage.local.set({ [STRUCTURE_VERSIONS_STORAGE_KEY]: remaining });
};

type CloudSnapshotClientOptions = {
    backendUrl: string;
    accountUserId?: string | null;
    canSaveCloudSnapshots: boolean;
    buildAuthHeaders: () => Record<string, string>;
    getAuthHeaders: () => Record<string, string>;
};

export class CloudSnapshotClient {
    constructor(private readonly options: CloudSnapshotClientOptions) {}

    async loadCloudSnapshots() {
        if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
            return [] as CloudSnapshot[];
        }

        try {
            const response = await fetch(`${this.options.backendUrl}/backups/${this.options.accountUserId}`, {
                headers: this.options.getAuthHeaders()
            });
            if (!response.ok) throw new Error('Failed to load Cloud Snapshots');
            const data = await response.json();
            return data.backups as CloudSnapshot[];
        } catch (error) {
            console.error('[CLOUD SNAPSHOTS] Fetch error:', error);
            return [] as CloudSnapshot[];
        }
    }

    async saveCurrentCloudSnapshot(customName?: string) {
        if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
            throw new Error('Create a free account to save Cloud Snapshots.');
        }

        const name = customName || `Cloud Snapshot ${new Date().toLocaleDateString()}`;
        const response = await fetch(`${this.options.backendUrl}/backups/${this.options.accountUserId}`, {
            method: 'POST',
            headers: this.options.buildAuthHeaders(),
            body: JSON.stringify({ name })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save Cloud Snapshot');
        }

        const data = await response.json().catch(() => ({}));
        const snapshotId = typeof data?.snapshotId === 'string' && data.snapshotId
            ? data.snapshotId
            : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        return {
            id: snapshotId,
            name,
            createdAt: new Date().toISOString(),
            summary: { folders: 0, bookmarks: 0 }
        } as CloudSnapshot;
    }

    async deleteCloudSnapshot(snapshotId: string) {
        if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
            throw new Error('Create a free account to manage Cloud Snapshots.');
        }

        const response = await fetch(`${this.options.backendUrl}/backups/${this.options.accountUserId}/${snapshotId}`, {
            method: 'DELETE',
            headers: this.options.getAuthHeaders()
        });

        if (!response.ok) throw new Error('Failed to delete Cloud Snapshot');
    }

    async restoreCloudSnapshot(snapshotId: string) {
        if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
            throw new Error('Create a free account to restore Cloud Snapshots.');
        }

        const response = await fetch(`${this.options.backendUrl}/backups/${this.options.accountUserId}/${snapshotId}/restore`, {
            method: 'POST',
            headers: this.options.getAuthHeaders()
        });

        if (!response.ok) throw new Error('Failed to restore Cloud Snapshot');
    }
}
