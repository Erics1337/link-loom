import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChromeBookmarkPlan } from '../chromeApplyPlan';

type BookmarkRecord = {
    id: string;
    parentId: string;
    title: string;
    url?: string;
};

const createChromeBookmarksMock = () => {
    let nextId = 100;
    const records = new Map<string, BookmarkRecord>([
        ['1', { id: '1', parentId: '0', title: 'Bookmarks Bar' }],
        ['2', { id: '2', parentId: '0', title: 'Other Bookmarks' }],
        ['3', { id: '3', parentId: '0', title: 'Mobile Bookmarks' }],
        ['old-folder', { id: 'old-folder', parentId: '1', title: 'Old Folder' }],
        ['chrome-1', { id: 'chrome-1', parentId: 'old-folder', title: 'Old Title', url: 'https://example.com' }],
    ]);

    return {
        records,
        api: {
            create: vi.fn(async ({ parentId, title }: { parentId: string; title: string }) => {
                const id = `created-${nextId++}`;
                records.set(id, { id, parentId, title });
                return records.get(id);
            }),
            update: vi.fn(async (id: string, update: { title: string }) => {
                const record = records.get(id);
                if (!record) throw new Error(`Missing bookmark ${id}`);
                record.title = update.title;
                return record;
            }),
            move: vi.fn(async (id: string, move: { parentId: string }) => {
                const record = records.get(id);
                if (!record) throw new Error(`Missing bookmark ${id}`);
                record.parentId = move.parentId;
                return record;
            }),
            getChildren: vi.fn(async (parentId: string) =>
                Array.from(records.values()).filter((record) => record.parentId === parentId)
            ),
            remove: vi.fn(async (id: string) => {
                records.delete(id);
            }),
            removeTree: vi.fn(async (id: string) => {
                const removeRecursive = (targetId: string) => {
                    for (const child of Array.from(records.values()).filter((record) => record.parentId === targetId)) {
                        removeRecursive(child.id);
                    }
                    records.delete(targetId);
                };
                removeRecursive(id);
            }),
        },
    };
};

describe('applyChromeBookmarkPlan', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('creates folders, trims title updates, moves bookmarks, and clears replaced root children', async () => {
        const chromeMock = createChromeBookmarksMock();
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api });

        const result = await applyChromeBookmarkPlan([
            {
                id: 'root-Bookmarks Bar',
                title: 'Bookmarks Bar',
                nodeType: 'root',
                rootTitle: 'Bookmarks Bar',
                children: [
                    {
                        id: 'folder-docs',
                        title: 'Docs',
                        nodeType: 'folder',
                        rootTitle: 'Bookmarks Bar',
                        children: [
                            {
                                id: 'bookmark-1',
                                title: ' New Title ',
                                originalTitle: 'Old Title',
                                url: 'https://example.com',
                                chromeId: 'chrome-1',
                                nodeType: 'bookmark',
                                rootTitle: 'Bookmarks Bar',
                            },
                        ],
                    },
                ],
            },
        ]);

        expect(result).toEqual({
            movedCount: 1,
            skippedCount: 0,
            folderCreateFailures: 0,
            shouldWarnAboutPartialApply: false,
        });
        expect(chromeMock.api.create).toHaveBeenCalledWith({ parentId: '1', title: 'Docs' });
        expect(chromeMock.api.update).toHaveBeenCalledWith('chrome-1', { title: 'New Title' });
        expect(chromeMock.records.get('chrome-1')?.parentId).toMatch(/^created-/);
        expect(chromeMock.records.has('old-folder')).toBe(false);
    });

    it('warns and leaves existing folders in place when a bookmark cannot be moved', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.api.move.mockRejectedValueOnce(new Error('move failed'));
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api });

        const result = await applyChromeBookmarkPlan([
            {
                id: 'root-Bookmarks Bar',
                title: 'Bookmarks Bar',
                nodeType: 'root',
                rootTitle: 'Bookmarks Bar',
                children: [
                    {
                        id: 'bookmark-1',
                        title: 'Old Title',
                        originalTitle: 'Old Title',
                        url: 'https://example.com',
                        chromeId: 'chrome-1',
                        nodeType: 'bookmark',
                        rootTitle: 'Bookmarks Bar',
                    },
                ],
            },
        ]);

        expect(result).toMatchObject({
            movedCount: 0,
            skippedCount: 1,
            shouldWarnAboutPartialApply: true,
        });
        expect(chromeMock.records.has('old-folder')).toBe(true);
        expect(chromeMock.api.removeTree).not.toHaveBeenCalledWith('old-folder');
    });
});
