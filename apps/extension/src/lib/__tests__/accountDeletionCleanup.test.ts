import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalAccountData } from '../accountDeletionCleanup';

describe('clearLocalAccountData', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('removes Link Loom local account and bookmark-derived data', async () => {
        const storage: Record<string, unknown> = {
            bookmarkWeaverOverflowBookmarks: [{ id: 'legacy' }],
            'bookmarkWeaverOverflowBookmarks:user-1': [{ id: '1' }],
            preOrganizeBackup: { tree: [{ title: 'Bookmarks' }] },
            bookmarkStructureVersions: [{ id: 'snapshot-1' }],
            bookmarkWeaverActiveApplyJournal: { id: 'journal-1' },
            deviceId: 'device-1',
            theme: 'dark',
            clusteringSettings: { folderDensity: 'medium' }
        };

        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async (key: string | string[] | null) => {
                        if (key === null) return { ...storage };
                        const keys = Array.isArray(key) ? key : [key];
                        return Object.fromEntries(
                            keys.map((item) => [item, storage[item]])
                        );
                    }),
                    remove: vi.fn(async (keys: string | string[]) => {
                        for (const key of Array.isArray(keys) ? keys : [keys]) {
                            delete storage[key];
                        }
                    })
                }
            }
        });

        await clearLocalAccountData();

        expect(storage).toEqual({
            theme: 'dark',
            clusteringSettings: { folderDensity: 'medium' }
        });
    });
});
