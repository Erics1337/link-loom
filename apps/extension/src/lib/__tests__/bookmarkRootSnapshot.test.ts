import { describe, expect, it } from 'vitest';
import {
    buildBookmarkRootSnapshot,
    collectScannedBookmarks,
} from '../bookmarkRootSnapshot';

describe('bookmarkRootSnapshot', () => {
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
            { id: 'a', title: 'A', url: 'https://a.example', parentId: 'root-1', parentTitle: undefined },
            { id: 'b', title: 'B', url: 'https://b.example', parentId: 'root-2', parentTitle: undefined },
        ]);
        expect(collectScannedBookmarks([
            { id: 'root', children: [{ id: 'c', url: 'https://c.example' }] },
        ])).toEqual([{ id: 'c', title: '', url: 'https://c.example', parentId: 'root', parentTitle: undefined }]);
        expect(collectScannedBookmarks([
            {
                id: 'root',
                title: 'Bookmarks Bar',
                children: [{ id: 'd', title: 'D', url: 'https://d.example', parentId: 'explicit-parent' }],
            },
        ])).toEqual([
            { id: 'd', title: 'D', url: 'https://d.example', parentId: 'explicit-parent', parentTitle: 'Bookmarks Bar' },
        ]);
    });
});
