import { beforeEach, describe, expect, it, vi } from 'vitest';

import { supabase } from '../../db';
import { assignBookmarksToCluster } from '../clustering/clusterPersistence';

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

        await assignBookmarksToCluster(bookmarkIds, 'cluster-1', log);

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

        await assignBookmarksToCluster(bookmarkIds, 'cluster-1', log);

        expect(log).toHaveBeenCalledWith(
            `Batch insert error for cluster cluster-1, assignments 500-500: ${JSON.stringify(error)}`
        );
    });
});
