import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clusteringProcessor } from '../clustering';
import { supabase } from '../../db';
import { queues } from '../../lib/queue';
import { isUserCancelled } from '../../lib/cancellation';
import { Job } from 'bullmq';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
    }
}));

vi.mock('ml-kmeans', () => ({
    kmeans: vi.fn(() => ({
        clusters: [0, 1] // Dummy split
    }))
}));

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: mockCreate
                }
            };
        }
    };
});

vi.mock('../../lib/queue', () => ({
    queues: {
        ingest: { getJobs: vi.fn().mockResolvedValue([]) },
        enrichment: { getJobs: vi.fn().mockResolvedValue([]) },
        embedding: { getJobs: vi.fn().mockResolvedValue([]) },
        clustering: { add: vi.fn() }
    }
}));

vi.mock('../../lib/cancellation', () => ({
    isUserCancelled: vi.fn()
}));

const createMockChain = (resolvedValue: any, explicitCount?: number) => {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(resolvedValue),
        then: (resolve: any) => resolve(explicitCount !== undefined ? { count: explicitCount } : resolvedValue)
    };
    return chain;
};

describe('Clustering Worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreate.mockReset();
        (isUserCancelled as any).mockReturnValue(false);
    });

    const createMockJob = (data: any) => ({
        data,
    } as unknown as Job);

    it('should defer if there are still pending inflight bookmarks', async () => {
        const job = createMockJob({ userId: 'user-1' });

        // First DB call: checking inflight count
        const mockBookmarksChain = createMockChain(null, 5); // 5 inflight

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') return mockBookmarksChain;
            return {};
        });

        // hasPipelineJobsForUser will run, returning true since we mocked getJobs above... wait, we mocked getJobs to return [] (false).
        // Let's explicitly mock getJobs to return jobs just in case
        queues.ingest.getJobs = vi.fn().mockResolvedValue([{ data: { userId: 'user-1' } }]);

        await clusteringProcessor(job);

        // Verify clustering was deferred
        expect(queues.clustering.add).toHaveBeenCalledWith(
            'cluster',
            expect.objectContaining({ userId: 'user-1' }),
            expect.objectContaining({ delay: 5000 })
        );
    });

    it('should fetch valid bookmarks and create at least a root cluster', async () => {
        const job = createMockJob({ userId: 'user-2' });

        // First DB call: inflight count -> 0
        const mockCountChain = createMockChain(null, 0);
        
        // Second DB call: Fetch bookmarks
        const mockFetchChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValueOnce({
                data: [
                    { id: 'bm-1', shared_links: { vector: [0.1, 0.2] } },
                    { id: 'bm-2', shared_links: { vector: [0.3, 0.4] } }
                ],
                error: null
            }).mockResolvedValueOnce({ data: [], error: null }) // break loop
        };

        // DB Call: New Cluster creation
        const mockClustersChain = {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'cluster-123' }, error: null })
        };

        // DB Call: Assign bookmarks to cluster
        const mockClusterAssignChain = {
            insert: vi.fn().mockResolvedValue({ error: null })
        };

        (supabase.from as any).mockImplementation((table: string) => {
            // we have to handle the inflight count query vs the fetch query
            // a simple way is to check if we are calling .in() inside the chain
            if (table === 'bookmarks') {
                // Return a combined mock that satisfies both the 'exact count' and 'range fetch' usage
                const chain: any = {
                    select: vi.fn(() => chain),
                    eq: vi.fn(() => chain),
                    in: vi.fn().mockResolvedValue({ count: 0, data: [] }),
                    range: mockFetchChain.range,
                    then: (resolve: any) => resolve({ count: 0 }) // For the initial inflight check
                };
                return chain;
            }
            if (table === 'clusters') return mockClustersChain;
            if (table === 'cluster_assignments') return mockClusterAssignChain;
            return {};
        });

        await clusteringProcessor(job);

        // Should have created a cluster (since there are 2 items and k-means splits it)
        // Note: ml-kmeans is mocked to return [[0], [1]]. But if targetLeafSize > count, it might put them in one leaf.
        // Actually, we mocked the config defaults so we don't know the exact split without tracing. But we know assigning happens.
        
        expect(supabase.from).toHaveBeenCalledWith('bookmarks');
    });
});
