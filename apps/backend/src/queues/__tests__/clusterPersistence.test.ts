import { beforeEach, describe, expect, it, vi } from 'vitest';

import { supabase } from '../../db';
import {
    assignBookmarksToCluster,
    fetchUserBookmarkVectorRows,
    MAX_BOOKMARKS,
} from '../clustering/clusterPersistence';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn()
    }
}));

describe('clusterPersistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('assigns bookmarks to a cluster in fixed-size batches', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        (supabase.from as any).mockReturnValue({ insert });
        const log = vi.fn();
        const bookmarkIds = Array.from(
            { length: 1001 },
            (_, index) => `bookmark-${index}`
        );

        const result = await assignBookmarksToCluster(bookmarkIds, 'cluster-1', log);

        expect(result).toEqual({
            success: true,
            total: 1001,
            inserted: 1001,
            failed: 0,
            failedBatches: [],
        });
        expect(insert).toHaveBeenCalledTimes(3);
        expect(insert.mock.calls[0][0]).toHaveLength(500);
        expect(insert.mock.calls[1][0]).toHaveLength(500);
        expect(insert.mock.calls[2][0]).toEqual([
            {
                cluster_id: 'cluster-1',
                bookmark_id: 'bookmark-1000'
            }
        ]);
        expect(log).not.toHaveBeenCalled();
    });

    it('fetches bookmark vector rows in paginated chunks', async () => {
        const firstChunk = Array.from({ length: 1000 }, (_, index) => ({
            id: `bookmark-${index}`,
            shared_links: { vector: [index] },
        }));
        const secondChunk = [{ id: 'bookmark-1000', shared_links: { vector: [1000] } }];
        const range = vi
            .fn()
            .mockResolvedValueOnce({ data: firstChunk, error: null })
            .mockResolvedValueOnce({ data: secondChunk, error: null });
        const eq = vi.fn(() => ({ range }));
        const select = vi.fn(() => ({ eq }));
        (supabase.from as any).mockReturnValue({ select });
        const log = vi.fn();

        const result = await fetchUserBookmarkVectorRows(
            'user-1',
            async () => false,
            log
        );

        expect(result).toEqual({ status: 'ok', rows: [...firstChunk, ...secondChunk] });
        expect(range).toHaveBeenCalledTimes(2);
        expect(range.mock.calls[0][0]).toBe(0);
        expect(range.mock.calls[1][0]).toBe(1000);
    });

    it('returns an error when fetched bookmarks exceed MAX_BOOKMARKS', async () => {
        const oversizedChunk = Array.from({ length: MAX_BOOKMARKS + 1 }, (_, index) => ({
            id: `bookmark-${index}`,
            shared_links: { vector: [index] },
        }));
        const range = vi.fn().mockResolvedValue({ data: oversizedChunk, error: null });
        const eq = vi.fn(() => ({ range }));
        const select = vi.fn(() => ({ eq }));
        (supabase.from as any).mockReturnValue({ select });
        const log = vi.fn();

        const result = await fetchUserBookmarkVectorRows(
            'user-1',
            async () => false,
            log
        );

        expect(result.status).toBe('error');
        expect(result).toMatchObject({
            error: expect.objectContaining({
                message: expect.stringContaining('too many bookmarks'),
            }),
        });
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining(`exceeds limit of ${MAX_BOOKMARKS}`)
        );
    });

    it('logs batch context when an assignment insert fails', async () => {
        const error = { message: 'payload too large' };
        const insert = vi
            .fn()
            .mockResolvedValueOnce({ error: null })
            .mockResolvedValueOnce({ error });
        (supabase.from as any).mockReturnValue({ insert });
        const log = vi.fn();
        const bookmarkIds = Array.from(
            { length: 501 },
            (_, index) => `bookmark-${index}`
        );

        const result = await assignBookmarksToCluster(bookmarkIds, 'cluster-1', log);

        expect(result).toEqual({
            success: false,
            total: 501,
            inserted: 500,
            failed: 1,
            failedBatches: [
                {
                    from: 500,
                    to: 500,
                    bookmarkIds: ['bookmark-500'],
                    error,
                },
            ],
        });
        expect(log).toHaveBeenCalledWith(
            `Batch insert error for cluster cluster-1, assignments 500-500: ${JSON.stringify(error)}`
        );
    });

    it('deduplicates bookmark ids before batching inserts', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        (supabase.from as any).mockReturnValue({ insert });
        const log = vi.fn();

        const result = await assignBookmarksToCluster(
            ['bookmark-1', 'bookmark-1', 'bookmark-2'],
            'cluster-1',
            log
        );

        expect(result).toEqual({
            success: true,
            total: 2,
            inserted: 2,
            failed: 0,
            failedBatches: [],
        });
        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert.mock.calls[0][0]).toEqual([
            { cluster_id: 'cluster-1', bookmark_id: 'bookmark-1' },
            { cluster_id: 'cluster-1', bookmark_id: 'bookmark-2' },
        ]);
    });
});
