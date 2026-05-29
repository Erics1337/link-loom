import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildBookmarkRootSnapshot,
    clearPersistedOverflowBookmarks,
    collectScannedBookmarks,
    createEmptyProgress,
    loadPersistedOverflowBookmarks,
    persistOverflowBookmarks,
    savePreOrganizeBackup,
} from '../processingSession';

describe('processingSession', () => {
    beforeEach(() => {
        vi.stubGlobal('chrome', undefined);
    });

    it('creates an empty progress object with every counter initialized', () => {
        expect(createEmptyProgress()).toEqual({
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
            isClusteringActive: false,
        });
    });

    it('maps actual and preferred bookmark roots through imported folders', () => {
        const snapshot = buildBookmarkRootSnapshot([
            {
                id: '0',
                children: [
                    {
                        id: '1',
                        title: 'Bookmarks Bar',
                        children: [
                            {
                                id: 'imported',
                                title: 'Imported',
                                children: [
                                    {
                                        id: 'mobile-folder',
                                        title: 'Mobile Bookmarks',
                                        children: [
                                            { id: 'bookmark-1', title: 'Mobile Link', url: 'https://m.example' },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]);

        expect(snapshot.availableRoots).toEqual(['Bookmarks Bar']);
        expect(snapshot.bookmarkRoots['bookmark-1']).toBe('Bookmarks Bar');
        expect(snapshot.preferredRoots['bookmark-1']).toBe('Mobile Bookmarks');
    });

    it('collects scanned bookmarks from every root and tolerates empty trees', () => {
        expect(collectScannedBookmarks([])).toEqual([]);
        expect(collectScannedBookmarks([
            {
                id: 'root-1',
                children: [{ id: 'a', title: 'A', url: 'https://a.example' }],
            },
            {
                id: 'root-2',
                children: [{ id: 'b', title: 'B', url: 'https://b.example' }],
            },
        ])).toEqual([
            { id: 'a', title: 'A', url: 'https://a.example' },
            { id: 'b', title: 'B', url: 'https://b.example' },
        ]);
    });

    it('persists overflow bookmarks and pre-organize backups through chrome storage', async () => {
        const stored: Record<string, unknown> = {};
        const storage = {
            get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, stored[key]]))),
            set: vi.fn(async (items: Record<string, unknown>) => Object.assign(stored, items)),
            remove: vi.fn(async (key: string) => {
                delete stored[key];
            }),
        };
        vi.stubGlobal('chrome', { storage: { local: storage } });
        vi.stubGlobal('crypto', { randomUUID: () => 'backup-id' });

        const overflow = [{ id: 'a', title: 'A', url: 'https://a.example' }];
        await persistOverflowBookmarks('user-1', overflow);
        expect(await loadPersistedOverflowBookmarks('user-1')).toEqual(overflow);

        await clearPersistedOverflowBookmarks('user-1');
        expect(await loadPersistedOverflowBookmarks('user-1')).toEqual([]);

        const backup = await savePreOrganizeBackup([{ id: 'root' }]);
        expect(backup).toEqual({
            id: 'backup-id',
            createdAt: expect.any(String),
            tree: [{ id: 'root' }],
        });
        expect(stored.preOrganizeBackup).toEqual(backup);
    });
});
