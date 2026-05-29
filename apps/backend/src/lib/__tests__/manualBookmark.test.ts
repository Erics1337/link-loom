import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueManualBookmark } from '../manualBookmark';
import { supabase } from '../../db';
import { queues } from '../queue';
import { beginUserPipelineRun } from '../cancellation';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

vi.mock('../queue', () => ({
    queues: {
        ingest: {
            add: vi.fn(),
        },
    },
}));

vi.mock('../cancellation', () => ({
    beginUserPipelineRun: vi.fn(),
}));

describe('queueManualBookmark', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (beginUserPipelineRun as any).mockResolvedValue(7);
    });

    it('rejects unsupported URL protocols before queueing work', async () => {
        const result = await queueManualBookmark({
            userId: 'user-1',
            rawUrl: 'file:///etc/passwd',
            freeTierLimit: 500,
            isPremium: true,
        });

        expect(result).toEqual({
            ok: false,
            statusCode: 400,
            payload: { error: 'Only http and https URLs can be saved.' },
        });
        expect(queues.ingest.add).not.toHaveBeenCalled();
    });

    it('queues valid manual links through ingest after clearing stale clusters', async () => {
        const countChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
        };
        const clusterChain = {
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        };

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') return countChain;
            if (table === 'clusters') return clusterChain;
            return {};
        });

        const result = await queueManualBookmark({
            userId: 'user-1',
            rawUrl: 'https://example.com/docs',
            title: 'Example Docs',
            freeTierLimit: 500,
            isPremium: false,
        });

        expect(result.ok).toBe(true);
        expect(beginUserPipelineRun).toHaveBeenCalledWith('user-1');
        expect(clusterChain.delete).toHaveBeenCalled();
        expect(queues.ingest.add).toHaveBeenCalledWith(
            'ingest',
            expect.objectContaining({
                userId: 'user-1',
                jobGeneration: 7,
                bookmarks: [
                    expect.objectContaining({
                        url: 'https://example.com/docs',
                        title: 'Example Docs',
                    }),
                ],
            })
        );
    });
});
