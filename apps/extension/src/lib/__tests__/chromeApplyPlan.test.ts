import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyChromeBookmarkPlan,
    buildChromeBookmarkApplyPlan,
    loadActiveChromeApplyJournal,
    resumeChromeBookmarkApplyJournal,
    rollbackChromeBookmarkApplyJournal,
} from '../chromeApplyPlan';

type BookmarkRecord = {
    id: string;
    parentId: string;
    title: string;
    url?: string;
};

const createChromeBookmarksMock = () => {
    let nextId = 100;
    const storage = new Map<string, unknown>();
    const records = new Map<string, BookmarkRecord>([
        ['1', { id: '1', parentId: '0', title: 'Bookmarks Bar' }],
        ['2', { id: '2', parentId: '0', title: 'Other Bookmarks' }],
        ['3', { id: '3', parentId: '0', title: 'Mobile Bookmarks' }],
        ['old-folder', { id: 'old-folder', parentId: '1', title: 'Old Folder' }],
        ['chrome-1', { id: 'chrome-1', parentId: 'old-folder', title: 'Old Title', url: 'https://example.com' }],
    ]);

    const buildSubTree = (targetId: string): any => {
        const record = records.get(targetId);
        if (!record) return null;
        const children = Array.from(records.values())
            .filter((child) => child.parentId === targetId)
            .map((child) => buildSubTree(child.id))
            .filter(Boolean);
        return { ...record, index: 0, children };
    };

    return {
        records,
        api: {
            create: vi.fn(async ({ parentId, title, url }: { parentId: string; title: string; url?: string }) => {
                const id = `created-${nextId++}`;
                records.set(id, { id, parentId, title, url });
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
            get: vi.fn(async (id: string) => {
                const record = records.get(id);
                return record ? [{ ...record, index: 0 }] : [];
            }),
            getSubTree: vi.fn(async (id: string) => {
                const node = buildSubTree(id);
                return node ? [node] : [];
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
        storageApi: {
            get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
            set: vi.fn(async (values: Record<string, unknown>) => {
                Object.entries(values).forEach(([key, value]) => storage.set(key, structuredClone(value)));
            }),
            remove: vi.fn(async (key: string) => {
                storage.delete(key);
            }),
        },
    };
};

describe('chrome bookmark apply plan', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('creates folders, trims title updates, moves bookmarks, and clears replaced root children', async () => {
        const chromeMock = createChromeBookmarksMock();
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
        const result = await applyChromeBookmarkPlan(plan);

        expect(plan.summary).toMatchObject({
            createFolderCount: 1,
            moveBookmarkCount: 1,
            renameBookmarkCount: 1,
            deleteRootChildCount: 1,
        });
        expect(result).toMatchObject({
            movedCount: 1,
            renamedCount: 1,
            deletedCount: 1,
            createdFolderCount: 1,
            skippedCount: 0,
            folderCreateFailures: 0,
            cleanupFailures: 0,
            shouldWarnAboutPartialApply: false,
        });
        expect(chromeMock.api.create).toHaveBeenCalledWith({
            parentId: '1',
            title: expect.stringContaining('[Link Loom apply'),
        });
        expect(chromeMock.api.update).toHaveBeenCalledWith('chrome-1', { title: 'New Title' });
        expect(chromeMock.records.get('chrome-1')?.parentId).toMatch(/^created-/);
        expect(chromeMock.records.get(chromeMock.records.get('chrome-1')!.parentId)?.title).toBe('Docs');
        expect(chromeMock.records.has('old-folder')).toBe(false);
        expect(chromeMock.api.getSubTree).not.toHaveBeenCalled();
        expect(await loadActiveChromeApplyJournal()).toBeNull();
    });

    it('warns, leaves existing folders in place, and keeps the journal when a bookmark cannot be moved', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.api.move.mockRejectedValueOnce(new Error('move failed'));
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
        const result = await applyChromeBookmarkPlan(plan);

        expect(result).toMatchObject({
            movedCount: 0,
            skippedCount: 1,
            shouldWarnAboutPartialApply: true,
        });
        expect(chromeMock.records.has('old-folder')).toBe(true);
        expect(chromeMock.api.removeTree).not.toHaveBeenCalledWith('old-folder');
        expect(await loadActiveChromeApplyJournal()).not.toBeNull();
    });

    it('does not roll back pending move entries that never applied', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.api.move.mockRejectedValueOnce(new Error('move failed'));
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                    },
                ],
            },
        ]);

        await applyChromeBookmarkPlan(plan);
        const journal = await loadActiveChromeApplyJournal();
        expect(journal?.entries.some((entry: any) => entry.type === 'moveBookmark' && entry.status === 'pending')).toBe(true);
        chromeMock.records.get('chrome-1')!.parentId = '2';

        await rollbackChromeBookmarkApplyJournal(journal!);

        expect(chromeMock.records.get('chrome-1')?.parentId).toBe('2');
        expect(await loadActiveChromeApplyJournal()).toBeNull();
    });

    it('resumes folder creation by adopting a previously created marker folder', async () => {
        const chromeMock = createChromeBookmarksMock();
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                        children: [
                            {
                                id: 'bookmark-1',
                                title: 'Old Title',
                                originalTitle: 'Old Title',
                                url: 'https://example.com',
                                chromeId: 'chrome-1',
                                nodeType: 'bookmark',
                            },
                        ],
                    },
                ],
            },
        ]);
        const folderPlanId = (plan.roots[0].children[0] as any).planId;
        chromeMock.records.set('created-marker', {
            id: 'created-marker',
            parentId: '1',
            title: `[Link Loom apply ${plan.id}:${folderPlanId}] Docs`,
        });

        const result = await resumeChromeBookmarkApplyJournal({
            id: plan.id,
            plan,
            phase: 'folders',
            createdFolderIdsByPlanId: {},
            entries: [
                {
                    type: 'createFolder',
                    status: 'pending',
                    planId: folderPlanId,
                    parentId: '1',
                    title: 'Docs',
                } as any,
            ],
            completed: false,
            updatedAt: new Date().toISOString(),
        });

        expect(result.shouldWarnAboutPartialApply).toBe(false);
        expect(chromeMock.records.get('created-marker')?.title).toBe('Docs');
        expect(chromeMock.records.get('chrome-1')?.parentId).toBe('created-marker');
        expect(chromeMock.api.create).not.toHaveBeenCalledWith({ parentId: '1', title: expect.stringContaining('Link Loom apply') });
        expect(await loadActiveChromeApplyJournal()).toBeNull();
    });

    it('does not delete a direct root bookmark after moving it into a planned folder', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.records.set('chrome-root', {
            id: 'chrome-root',
            parentId: '1',
            title: 'Root Bookmark',
            url: 'https://root.example',
        });
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                        children: [
                            {
                                id: 'bookmark-root',
                                title: 'Root Bookmark',
                                originalTitle: 'Root Bookmark',
                                url: 'https://root.example',
                                chromeId: 'chrome-root',
                                nodeType: 'bookmark',
                            },
                        ],
                    },
                ],
            },
        ]);

        const result = await applyChromeBookmarkPlan(plan);

        expect(result.shouldWarnAboutPartialApply).toBe(false);
        expect(chromeMock.records.has('chrome-root')).toBe(true);
        expect(chromeMock.records.get('chrome-root')?.parentId).toMatch(/^created-/);
        expect(chromeMock.api.remove).not.toHaveBeenCalledWith('chrome-root');
    });

    it('does not delete root children added after the user confirmed the apply plan', async () => {
        const chromeMock = createChromeBookmarksMock();
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                        children: [
                            {
                                id: 'bookmark-1',
                                title: 'Old Title',
                                originalTitle: 'Old Title',
                                url: 'https://example.com',
                                chromeId: 'chrome-1',
                                nodeType: 'bookmark',
                            },
                        ],
                    },
                ],
            },
        ]);
        chromeMock.records.set('new-root-child', {
            id: 'new-root-child',
            parentId: '1',
            title: 'Added During Apply',
            url: 'https://new.example',
        });

        const result = await applyChromeBookmarkPlan(plan);

        expect(result.shouldWarnAboutPartialApply).toBe(false);
        expect(chromeMock.records.has('new-root-child')).toBe(true);
        expect(chromeMock.records.has('old-folder')).toBe(false);
        expect(chromeMock.api.remove).not.toHaveBeenCalledWith('new-root-child');
    });

    it('resumes cleanup after one root child was already deleted and a later delete failed', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.records.set('stale-folder', { id: 'stale-folder', parentId: '1', title: 'Stale Folder' });
        chromeMock.api.removeTree
            .mockImplementationOnce(async (id: string) => {
                if (id === 'stale-folder') {
                    chromeMock.records.delete(id);
                }
            })
            .mockRejectedValueOnce(new Error('cleanup failed'));
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                        children: [
                            {
                                id: 'bookmark-1',
                                title: 'Old Title',
                                originalTitle: 'Old Title',
                                url: 'https://example.com',
                                chromeId: 'chrome-1',
                                nodeType: 'bookmark',
                            },
                        ],
                    },
                ],
            },
        ]);

        const firstResult = await applyChromeBookmarkPlan(plan);
        expect(firstResult.shouldWarnAboutPartialApply).toBe(true);
        expect(chromeMock.records.has('stale-folder')).toBe(false);
        expect(chromeMock.records.has('old-folder')).toBe(true);

        const journal = await loadActiveChromeApplyJournal();
        expect(journal).not.toBeNull();
        const resumeResult = await resumeChromeBookmarkApplyJournal(journal!);

        expect(resumeResult.shouldWarnAboutPartialApply).toBe(false);
        expect(chromeMock.records.has('old-folder')).toBe(false);
        expect(await loadActiveChromeApplyJournal()).toBeNull();
    });

    it('rolls back created folders, moves, renames, and root cleanup from the journal', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.api.removeTree.mockRejectedValueOnce(new Error('cleanup failed'));
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                        children: [
                            {
                                id: 'bookmark-1',
                                title: 'New Title',
                                originalTitle: 'Old Title',
                                url: 'https://example.com',
                                chromeId: 'chrome-1',
                                nodeType: 'bookmark',
                            },
                        ],
                    },
                ],
            },
        ]);

        const result = await applyChromeBookmarkPlan(plan);
        expect(result.shouldWarnAboutPartialApply).toBe(true);

        const journal = await loadActiveChromeApplyJournal();
        expect(journal).not.toBeNull();
        await rollbackChromeBookmarkApplyJournal(journal!);

        expect(chromeMock.records.get('chrome-1')).toMatchObject({
            parentId: 'old-folder',
            title: 'Old Title',
        });
        expect(Array.from(chromeMock.records.values()).some((record) => record.title === 'Docs')).toBe(false);
        expect(await loadActiveChromeApplyJournal()).toBeNull();
    });

    it('rolls back an applied cleanup delete from compact target metadata', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.records.set('stale-bookmark', {
            id: 'stale-bookmark',
            parentId: '1',
            title: 'Stale Bookmark',
            url: 'https://stale.example',
        });
        chromeMock.api.removeTree.mockRejectedValueOnce(new Error('cleanup failed'));
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                        children: [
                            {
                                id: 'bookmark-1',
                                title: 'Old Title',
                                originalTitle: 'Old Title',
                                url: 'https://example.com',
                                chromeId: 'chrome-1',
                                nodeType: 'bookmark',
                            },
                        ],
                    },
                ],
            },
        ]);

        await applyChromeBookmarkPlan(plan);
        expect(chromeMock.records.has('stale-bookmark')).toBe(false);
        const journal = await loadActiveChromeApplyJournal();
        expect(journal).not.toBeNull();

        await rollbackChromeBookmarkApplyJournal(journal!);

        expect(Array.from(chromeMock.records.values())).toContainEqual(
            expect.objectContaining({
                parentId: '1',
                title: 'Stale Bookmark',
                url: 'https://stale.example',
            })
        );
        expect(chromeMock.api.getSubTree).not.toHaveBeenCalled();
        expect(await loadActiveChromeApplyJournal()).toBeNull();
    });

    it('continues rollback when manually edited entries are already missing', async () => {
        const chromeMock = createChromeBookmarksMock();
        chromeMock.api.removeTree.mockRejectedValueOnce(new Error('cleanup failed'));
        vi.stubGlobal('chrome', { bookmarks: chromeMock.api, storage: { local: chromeMock.storageApi } });

        const plan = await buildChromeBookmarkApplyPlan([
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
                        children: [
                            {
                                id: 'bookmark-1',
                                title: 'New Title',
                                originalTitle: 'Old Title',
                                url: 'https://example.com',
                                chromeId: 'chrome-1',
                                nodeType: 'bookmark',
                            },
                        ],
                    },
                ],
            },
        ]);

        await applyChromeBookmarkPlan(plan);
        const journal = await loadActiveChromeApplyJournal();
        expect(journal).not.toBeNull();
        const createdFolderIds = Object.values(journal!.createdFolderIdsByPlanId);
        createdFolderIds.forEach((id) => chromeMock.records.delete(id));
        chromeMock.records.delete('chrome-1');

        await rollbackChromeBookmarkApplyJournal(journal!);

        expect(await loadActiveChromeApplyJournal()).toBeNull();
    });
});
