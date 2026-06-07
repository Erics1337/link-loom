import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearPersistedOverflowBookmarks,
    loadPersistedOverflowBookmarks,
    persistOverflowBookmarks,
    savePreOrganizeBackup,
} from '../processingSessionStorage';

describe('processingSessionStorage', () => {
    beforeEach(() => {
        vi.stubGlobal('chrome', undefined);
    });

    it('persists overflow bookmarks and Safety Backups through chrome storage', async () => {
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
