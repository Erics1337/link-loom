import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestProcessor } from '../ingest';
import { supabase } from '../../db';
import { queues } from '../../lib/queue';
import { isUserCancelled } from '../../lib/cancellation';
import { recordPipelineIngestCompleted } from '../../lib/pipelineCoordinator';
import { QueueJob } from '../../lib/queue';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
    }
}));

vi.mock('../../lib/queue', () => ({
    queues: {
        enrichment: {
            add: vi.fn()
        },
        clustering: {
            add: vi.fn()
        }
    }
}));

vi.mock('../../lib/cancellation', () => ({
    isUserCancelled: vi.fn()
}));

vi.mock('../../lib/pipelineCoordinator', () => ({
    notifyPipelineBookmarkTerminal: vi.fn(),
    recordPipelineIngestCompleted: vi.fn(),
    recordPipelineUntrackedError: vi.fn(),
}));

const createMockChain = (resolvedValue: any) => {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(resolvedValue),
        upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue(resolvedValue) // reuse for upserts returning data
        }),
        update: vi.fn().mockReturnThis()
    };
};

describe('Ingest Worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (isUserCancelled as any).mockReturnValue(false);
    });

    const createMockJob = (data: any) => ({
        data,
        updateProgress: vi.fn(),
    } as unknown as QueueJob<any>);

    it('should correctly process a cache MISS and enqueue to enrichment', async () => {
        const job = createMockJob({
            userId: 'user-1',
            pipelineRunId: 'run-9',
            jobGeneration: 9,
            bookmarks: [
                { id: 'c-1', url: 'https://example.com', title: 'Example' }
            ],
            clusteringSettings: {
                clusters: 20
            }
        });

        const mockUsersChain = createMockChain({ data: { id: 'user-1' } });
        const mockSharedLinksChain = createMockChain({ data: null, error: null }); // No vector (cache miss)
        const mockBookmarksChain = createMockChain({ data: { id: 'bm-1', url: 'https://example.com' }, error: null });

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'users') return mockUsersChain;
            if (table === 'shared_links') return mockSharedLinksChain;
            if (table === 'bookmarks') return mockBookmarksChain;
            return {};
        });

        await ingestProcessor(job);

        // Verify bookmark upserted
        expect(mockBookmarksChain.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                user_id: 'user-1',
                chrome_id: 'c-1',
                url: 'https://example.com',
                pipeline_run_id: 'run-9',
            }),
            { onConflict: 'chrome_id,user_id' }
        );

        // Verify enqueue to enrichment
        expect(queues.enrichment.add).toHaveBeenCalledWith(
            'enrich',
            expect.objectContaining({
                userId: 'user-1',
                pipelineRunId: 'run-9',
                jobGeneration: 9,
                bookmarkId: 'bm-1',
                url: 'https://example.com',
            }),
            { jobId: 'enrich-user-1-run-run-9-bm-1' }
        );

        expect(queues.clustering.add).not.toHaveBeenCalled();
        expect(recordPipelineIngestCompleted).toHaveBeenCalledWith(
            'user-1',
            9,
            'run-9',
            expect.any(Object)
        );
        expect(isUserCancelled).toHaveBeenCalledWith('user-1', 9, 'run-9');
    });

    it('should stop processing if cancelled mid-ingest', async () => {
        (isUserCancelled as any)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true); // cancelled on first loop iteration

        const job = createMockJob({
            userId: 'user-1',
            pipelineRunId: 'run-10',
            jobGeneration: 10,
            bookmarks: [
                { id: 'c-1', url: 'https://example.com', title: 'Example' },
            ]
        });

        const mockUsersChain = createMockChain({ data: { id: 'user-1' } });
        (supabase.from as any).mockImplementation((table: string) => mockUsersChain);

        await ingestProcessor(job);

        expect(queues.enrichment.add).not.toHaveBeenCalled();
        expect(queues.clustering.add).not.toHaveBeenCalled();
        expect(isUserCancelled).toHaveBeenCalledWith('user-1', 10, 'run-10');
    });
});
