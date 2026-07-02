import { describe, expect, it } from 'vitest';
import { buildStructurePreview } from '../structurePreviewBuilder';

describe('buildStructurePreview', () => {
    it('builds root-aware cluster trees and duplicate summaries', () => {
        const result = buildStructurePreview({
            data: {
                clusters: [
                    { id: 'root-cluster', name: 'Reading', parent_id: null },
                    { id: 'child-cluster', name: 'Docs', parent_id: 'root-cluster' },
                ],
                assignments: [
                    {
                        cluster_id: 'child-cluster',
                        bookmark_id: 'bookmark-1',
                        bookmarks: {
                            title: 'Original Docs',
                            ai_title: 'Better Docs',
                            url: 'https://example.com/docs',
                            chrome_id: 'chrome-1',
                        },
                    },
                    {
                        cluster_id: 'child-cluster',
                        bookmark_id: 'bookmark-2',
                        bookmarks: {
                            title: 'Duplicate Docs',
                            url: 'https://example.com/docs',
                            chrome_id: 'chrome-2',
                        },
                    },
                ],
            },
            availableRoots: ['Bookmarks Bar', 'Other Bookmarks'],
            bookmarkRootMap: {
                'chrome-1': 'Bookmarks Bar',
                'chrome-2': 'Bookmarks Bar',
            },
            bookmarkPreferredRootMap: {
                'chrome-1': 'Bookmarks Bar',
                'chrome-2': 'Bookmarks Bar',
            },
            overflowBookmarks: [],
            originalTree: [],
            defaultRootTitle: 'Other Bookmarks',
        });

        expect(result.duplicateCount).toBe(1);
        expect(result.assignmentSummaries).toEqual([
            {
                bookmarkId: 'bookmark-1',
                chromeId: 'chrome-1',
                url: 'https://example.com/docs',
                rootTitle: 'Bookmarks Bar',
            },
            {
                bookmarkId: 'bookmark-2',
                chromeId: 'chrome-2',
                url: 'https://example.com/docs',
                rootTitle: 'Bookmarks Bar',
            },
        ]);
        expect(result.rootNodes).toHaveLength(2);
        expect(result.rootNodes[0]).toMatchObject({
            title: 'Bookmarks Bar',
            children: [
                {
                    title: 'Reading',
                    children: [
                        {
                            title: 'Docs',
                            children: [
                                {
                                    title: 'Better Docs',
                                    originalTitle: 'Original Docs',
                                    chromeId: 'chrome-1',
                                },
                                {
                                    title: 'Duplicate Docs',
                                    chromeId: 'chrome-2',
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('surfaces top-3 cluster keywords and flags the farthest bookmarks as low confidence', () => {
        const assignments = Array.from({ length: 6 }, (_, index) => ({
            cluster_id: 'child-cluster',
            bookmark_id: `bookmark-${index}`,
            distance_to_centroid: index, // 0..5, bookmark-5 is farthest
            bookmarks: {
                title: `Doc ${index}`,
                url: `https://example.com/doc-${index}`,
                chrome_id: `chrome-${index}`,
            },
        }));

        const result = buildStructurePreview({
            data: {
                clusters: [
                    { id: 'root-cluster', name: 'Reading', parent_id: null },
                    {
                        id: 'child-cluster',
                        name: 'Docs',
                        parent_id: 'root-cluster',
                        keywords: ['docs', 'reading', 'guides', 'extra', 'more'],
                    },
                ],
                assignments,
            },
            availableRoots: ['Bookmarks Bar', 'Other Bookmarks'],
            bookmarkRootMap: Object.fromEntries(
                assignments.map((assignment) => [assignment.bookmarks.chrome_id, 'Bookmarks Bar'])
            ),
            bookmarkPreferredRootMap: {},
            overflowBookmarks: [],
            originalTree: [],
            defaultRootTitle: 'Other Bookmarks',
        });

        const docsFolder = result.rootNodes[0].children?.[0].children?.[0];
        expect(docsFolder?.keywords).toEqual(['docs', 'reading', 'guides']);

        const bookmarkNodes = docsFolder?.children ?? [];
        const lowConfidenceIds = bookmarkNodes
            .filter((node) => node.lowConfidence)
            .map((node) => node.chromeId)
            .sort();
        expect(lowConfidenceIds).toEqual(['chrome-3', 'chrome-4', 'chrome-5']);
        expect(bookmarkNodes.find((node) => node.chromeId === 'chrome-0')?.lowConfidence).toBeUndefined();
    });

    it('keeps overflow bookmarks under Other Bookmarks with a badge', () => {
        const result = buildStructurePreview({
            data: { clusters: [], assignments: [] },
            availableRoots: ['Bookmarks Bar', 'Other Bookmarks'],
            bookmarkRootMap: { 'overflow-1': 'Other Bookmarks' },
            bookmarkPreferredRootMap: {},
            overflowBookmarks: [
                { id: 'overflow-1', title: 'Loose Link', url: 'https://loose.example' },
            ],
            originalTree: [
                {
                    id: 'root',
                    children: [
                        {
                            id: '2',
                            title: 'Other Bookmarks',
                            children: [
                                {
                                    id: 'folder-1',
                                    title: 'Saved',
                                    children: [
                                        {
                                            id: 'overflow-1',
                                            title: 'Loose Link',
                                            url: 'https://loose.example',
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
            defaultRootTitle: 'Other Bookmarks',
        });

        const otherBookmarks = result.rootNodes.find((node) => node.rootTitle === 'Other Bookmarks');
        expect(otherBookmarks).toMatchObject({
            badgeLabel: '1 extra',
            children: [
                {
                    title: 'Unorganized Bookmarks',
                    isOverflow: true,
                    children: [
                        {
                            title: 'Saved',
                            isOverflow: true,
                            children: [
                                {
                                    title: 'Loose Link',
                                    chromeId: 'overflow-1',
                                    isOverflow: true,
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });
});
