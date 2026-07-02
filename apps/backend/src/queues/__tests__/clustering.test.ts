import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clusteringProcessor } from '../clustering';
import { supabase } from '../../db';
import { completePipelineRun, isUserCancelled } from '../../lib/cancellation';
import {
    recordPipelineClusteringCompleted,
    shouldExecutePipelineClustering,
} from '../../lib/pipelineCoordinator';
import { QueueJob, queues } from '../../lib/queue';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
        rpc: vi.fn(),
    }
}));

// Every test's `cluster_assignments` mock needs to answer both the pinned-id
// lookup (fetchPinnedBookmarkIds) and the assignment insert; this is the
// no-pinned-bookmarks default used everywhere except the pinning-specific test.
const createClusterAssignmentsChain = (insert: any) => ({
    select: vi.fn(() => ({
        eq: vi.fn(() => ({
            eq: vi.fn(() => ({
                range: vi.fn().mockResolvedValue({ data: [], error: null })
            }))
        }))
    })),
    insert
});

const { mockCreate, mockKmeans } = vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockKmeans: vi.fn()
}));

vi.mock('ml-kmeans', () => ({
    kmeans: mockKmeans
}));

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
        clustering: { add: vi.fn() }
    }
}));

vi.mock('../../lib/cancellation', () => ({
    completePipelineRun: vi.fn(),
    isUserCancelled: vi.fn()
}));

vi.mock('../../lib/pipelineCoordinator', () => ({
    recordPipelineClusteringCompleted: vi.fn(),
    shouldExecutePipelineClustering: vi.fn(),
}));

const createMockChain = (resolvedValue: any, explicitCount?: number) => {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
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
        mockKmeans.mockReset();
        mockKmeans.mockReturnValue({
            clusters: [0, 1]
        });
        (completePipelineRun as any).mockResolvedValue(undefined);
        (isUserCancelled as any).mockReturnValue(false);
        (shouldExecutePipelineClustering as any).mockResolvedValue(true);
        (supabase.rpc as any).mockResolvedValue({ error: null });
    });

    const createMockJob = (data: any) => ({
        data,
    } as unknown as QueueJob<any>);

    it('should complete an empty run when no bookmarks are available', async () => {
        const job = createMockJob({ userId: 'user-1', pipelineRunId: 'run-11', jobGeneration: 11 });

        const mockBookmarksChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({ data: [], error: null }),
        };

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') return mockBookmarksChain;
            if (table === 'cluster_assignments') return createClusterAssignmentsChain(vi.fn());
            return {};
        });

        await clusteringProcessor(job);

        expect(recordPipelineClusteringCompleted).toHaveBeenCalledWith('user-1', 11, 'run-11');
        expect(completePipelineRun).toHaveBeenCalledWith('run-11', {
            totalBookmarks: 0,
            embeddedBookmarks: 0,
            assignedBookmarks: 0,
        });
        expect(isUserCancelled).toHaveBeenCalledWith('user-1', 11, 'run-11');
    });

    it('should fetch valid bookmarks and create at least a root cluster', async () => {
        const job = createMockJob({ userId: 'user-2', pipelineRunId: 'run-12', jobGeneration: 12 });

        // Second DB call: Fetch bookmarks
        const mockFetchChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
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
                    order: vi.fn(() => chain),
                    in: vi.fn().mockResolvedValue({ count: 0, data: [] }),
                    range: mockFetchChain.range,
                    then: (resolve: any) => resolve({ count: 0 }) // For the initial inflight check
                };
                return chain;
            }
            if (table === 'clusters') return mockClustersChain;
            if (table === 'cluster_assignments') return createClusterAssignmentsChain(mockClusterAssignChain.insert);
            return {};
        });

        await clusteringProcessor(job);

        // Should have created a cluster (since there are 2 items and k-means splits it)
        // Note: ml-kmeans is mocked to return [[0], [1]]. But if targetLeafSize > count, it might put them in one leaf.
        // Actually, we mocked the config defaults so we don't know the exact split without tracing. But we know assigning happens.
        
        expect(supabase.from).toHaveBeenCalledWith('bookmarks');
        expect(recordPipelineClusteringCompleted).toHaveBeenCalledWith('user-2', 12, 'run-12');
        expect(completePipelineRun).toHaveBeenCalledWith('run-12', expect.objectContaining({
            totalBookmarks: 2,
            embeddedBookmarks: 2,
            assignedBookmarks: 2,
        }));
        expect(isUserCancelled).toHaveBeenCalledWith('user-2', 12, 'run-12');
    });

    it('should accept Supabase joined vectors returned as arrays', async () => {
        const job = createMockJob({ userId: 'user-3' });
        const mockAssignmentInsert = vi.fn().mockResolvedValue({ error: null });

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') {
                const chain: any = {
                    select: vi.fn(() => chain),
                    eq: vi.fn(() => chain),
                    order: vi.fn(() => chain),
                    in: vi.fn().mockResolvedValue({ count: 0, data: [] }),
                    range: vi.fn()
                        .mockResolvedValueOnce({
                            data: [
                                { id: 'bm-1', shared_links: [{ vector: [0.1, 0.2] }] },
                                { id: 'bm-2', shared_links: [{ vector: [0.3, 0.4] }] }
                            ],
                            error: null
                        })
                        .mockResolvedValueOnce({ data: [], error: null }),
                    then: (resolve: any) => resolve({ count: 0 })
                };
                return chain;
            }

            if (table === 'clusters') {
                return {
                    insert: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { id: 'cluster-array-shape' }, error: null })
                };
            }

            if (table === 'cluster_assignments') {
                return createClusterAssignmentsChain(mockAssignmentInsert);
            }

            return {};
        });

        await clusteringProcessor(job);

        expect(mockAssignmentInsert).toHaveBeenCalledWith([
            expect.objectContaining({ cluster_id: 'cluster-array-shape', bookmark_id: 'bm-1' }),
            expect.objectContaining({ cluster_id: 'cluster-array-shape', bookmark_id: 'bm-2' })
        ]);
        expect(recordPipelineClusteringCompleted).not.toHaveBeenCalled();
        expect(completePipelineRun).not.toHaveBeenCalled();
    });

    it('should assign to the current parent when LLM refinement merges siblings into one group', async () => {
        process.env.OPENAI_API_KEY = 'test-key';
        const job = createMockJob({
            userId: 'user-merge',
            pipelineRunId: 'run-merge',
            jobGeneration: 18,
            clusteringSettings: { folderDensity: 'medium' }
        });
        const bookmarkRows = Array.from({ length: 24 }, (_, index) => ({
            id: `bm-${index}`,
            title: `AI workflow ${index}`,
            description: 'Automation tools',
            url: `https://example.com/${index}`,
            shared_links: {
                vector: index < 12 ? [0.1, 0.1] : [0.2, 0.2]
            }
        }));
        const mockAssignmentInsert = vi.fn().mockResolvedValue({ error: null });
        const mockClusterInsert = vi.fn().mockReturnThis();

        mockCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            labels: [{ groupIndex: 0, name: 'AI Workflows' }],
                            merges: [
                                {
                                    sourceGroupIndex: 1,
                                    targetGroupIndex: 0,
                                    reason: 'same topic'
                                }
                            ]
                        })
                    }
                }
            ]
        });
        mockKmeans.mockReturnValue({
            clusters: bookmarkRows.map((_, index) => (index < 12 ? 0 : 1))
        });

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') {
                const chain: any = {
                    select: vi.fn(() => chain),
                    eq: vi.fn(() => chain),
                    order: vi.fn(() => chain),
                    in: vi.fn().mockResolvedValue({
                        data: bookmarkRows.map(({ id, title, description, url }) => ({
                            id,
                            title,
                            description,
                            url
                        })),
                        error: null
                    }),
                    range: vi.fn()
                        .mockResolvedValueOnce({
                            data: bookmarkRows.map(({ id, shared_links }) => ({
                                id,
                                shared_links
                            })),
                            error: null
                        })
                        .mockResolvedValueOnce({ data: [], error: null }),
                    then: (resolve: any) => resolve({ count: 0 })
                };
                return chain;
            }

            if (table === 'clusters') {
                return {
                    insert: mockClusterInsert,
                    select: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { id: 'root-cluster' }, error: null })
                };
            }

            if (table === 'cluster_assignments') {
                return createClusterAssignmentsChain(mockAssignmentInsert);
            }

            return {};
        });

        await clusteringProcessor(job);

        expect(mockClusterInsert).toHaveBeenCalledTimes(1);
        expect(mockClusterInsert).toHaveBeenCalledWith({
            user_id: 'user-merge',
            name: 'AI Workflows',
            parent_id: null,
            keywords: ['workflow', 'automation', 'tools']
        });
        expect(mockAssignmentInsert).toHaveBeenCalledTimes(1);
        expect(mockAssignmentInsert).toHaveBeenCalledWith(
            expect.arrayContaining(
                bookmarkRows.map((bookmark) =>
                    expect.objectContaining({
                        cluster_id: 'root-cluster',
                        bookmark_id: bookmark.id
                    })
                )
            )
        );
        expect(completePipelineRun).toHaveBeenCalledWith('run-merge', {
            totalBookmarks: 24,
            embeddedBookmarks: 24,
            assignedBookmarks: 24
        });
    });

    it('should not write any clusters or assignments when cancelled after the tree is built but before persistence', async () => {
        const job = createMockJob({ userId: 'user-8', pipelineRunId: 'run-18', jobGeneration: 18 });

        // Let every check up through the in-memory tree build report "not
        // cancelled", then report cancellation right before persistence
        // starts. If clusters/assignments were still written incrementally
        // during the build (the pre-fix behavior), this would already have
        // inserted a cluster row by now.
        let cancelCheckCount = 0;
        (isUserCancelled as any).mockImplementation(async () => {
            cancelCheckCount += 1;
            return cancelCheckCount > 4;
        });

        const mockFetchChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn()
                .mockResolvedValueOnce({
                    data: [
                        { id: 'bm-1', shared_links: { vector: [0.1, 0.2] } },
                        { id: 'bm-2', shared_links: { vector: [0.3, 0.4] } }
                    ],
                    error: null
                })
                .mockResolvedValueOnce({ data: [], error: null })
        };

        const mockClustersChain = {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'cluster-should-not-be-created' }, error: null })
        };
        const mockClusterAssignChain = { insert: vi.fn().mockResolvedValue({ error: null }) };

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') {
                const chain: any = {
                    select: vi.fn(() => chain),
                    eq: vi.fn(() => chain),
                    order: vi.fn(() => chain),
                    in: vi.fn().mockResolvedValue({ count: 0, data: [] }),
                    range: mockFetchChain.range,
                    then: (resolve: any) => resolve({ count: 0 })
                };
                return chain;
            }
            if (table === 'clusters') return mockClustersChain;
            if (table === 'cluster_assignments') return createClusterAssignmentsChain(mockClusterAssignChain.insert);
            return {};
        });

        await clusteringProcessor(job);

        expect(mockClustersChain.insert).not.toHaveBeenCalled();
        expect(mockClusterAssignChain.insert).not.toHaveBeenCalled();
        expect(recordPipelineClusteringCompleted).not.toHaveBeenCalled();
        expect(completePipelineRun).not.toHaveBeenCalled();
    });

    it('should stop without completing the pipeline when fetch is cancelled mid-pagination', async () => {
        const job = createMockJob({ userId: 'user-4', pipelineRunId: 'run-14', jobGeneration: 14 });

        (isUserCancelled as any)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        const mockFetchChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValueOnce({
                data: Array.from({ length: 1000 }, (_, i) => ({
                    id: `bm-${i}`,
                    shared_links: { vector: [0.1, 0.2] }
                })),
                error: null
            })
        };

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') return mockFetchChain;
            if (table === 'cluster_assignments') return createClusterAssignmentsChain(vi.fn());
            return {};
        });

        await clusteringProcessor(job);

        expect(recordPipelineClusteringCompleted).not.toHaveBeenCalled();
        expect(completePipelineRun).not.toHaveBeenCalled();
    });

    it('should throw when bookmark fetch fails so the queue can retry', async () => {
        const job = createMockJob({ userId: 'user-5', pipelineRunId: 'run-15', jobGeneration: 15 });

        const mockFetchChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'connection refused' }
            })
        };

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') return mockFetchChain;
            if (table === 'cluster_assignments') return createClusterAssignmentsChain(vi.fn());
            return {};
        });

        await expect(clusteringProcessor(job)).rejects.toThrow(
            'Failed to fetch bookmarks for clustering: connection refused'
        );
        expect(recordPipelineClusteringCompleted).not.toHaveBeenCalled();
        expect(completePipelineRun).not.toHaveBeenCalled();
    });

    it('should record clustering completion but skip completePipelineRun when pipelineRunId is missing', async () => {
        const job = createMockJob({ userId: 'user-6', jobGeneration: 16 });

        const mockFetchChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({ data: [], error: null }),
        };

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') return mockFetchChain;
            if (table === 'cluster_assignments') return createClusterAssignmentsChain(vi.fn());
            return {};
        });

        await clusteringProcessor(job);

        expect(recordPipelineClusteringCompleted).toHaveBeenCalledWith('user-6', 16, undefined);
        expect(completePipelineRun).not.toHaveBeenCalled();
    });

    it('should exclude pinned bookmarks from clustering and count them as assigned', async () => {
        const job = createMockJob({ userId: 'user-pin', pipelineRunId: 'run-pin', jobGeneration: 20 });
        mockKmeans.mockReturnValue({ clusters: [0] });

        const mockClustersChain = {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'cluster-unpinned' }, error: null })
        };
        const mockAssignmentInsert = vi.fn().mockResolvedValue({ error: null });
        const rpcCalls: any[] = [];
        (supabase.rpc as any).mockImplementation((name: string, args: any) => {
            rpcCalls.push([name, args]);
            return Promise.resolve({ error: null });
        });

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'bookmarks') {
                const chain: any = {
                    select: vi.fn(() => chain),
                    eq: vi.fn(() => chain),
                    order: vi.fn(() => chain),
                    range: vi.fn()
                        .mockResolvedValueOnce({
                            data: [
                                { id: 'bm-pinned', shared_links: { vector: [0.9, 0.9] } },
                                { id: 'bm-unpinned', shared_links: { vector: [0.1, 0.1] } }
                            ],
                            error: null
                        })
                        .mockResolvedValueOnce({ data: [], error: null }),
                    in: vi.fn().mockResolvedValue({
                        data: [{ title: 'Unpinned', description: '', url: 'https://example.com' }],
                        error: null
                    })
                };
                return chain;
            }
            if (table === 'cluster_assignments') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            eq: vi.fn(() => ({
                                range: vi.fn().mockResolvedValue({
                                    data: [{ bookmark_id: 'bm-pinned' }],
                                    error: null
                                })
                            }))
                        }))
                    })),
                    insert: mockAssignmentInsert
                };
            }
            if (table === 'clusters') return mockClustersChain;
            return {};
        });

        await clusteringProcessor(job);

        // clear_unpinned_cluster_assignments ran before clustering, leaving the pin alone.
        expect(rpcCalls.some(([name]) => name === 'clear_unpinned_cluster_assignments')).toBe(true);

        // Only the unpinned bookmark's vector reaches k-means.
        expect(mockKmeans).not.toHaveBeenCalled(); // single item resolves to a leaf without splitting
        expect(mockAssignmentInsert).toHaveBeenCalledWith([
            expect.objectContaining({ cluster_id: 'cluster-unpinned', bookmark_id: 'bm-unpinned' })
        ]);
        expect(completePipelineRun).toHaveBeenCalledWith('run-pin', expect.objectContaining({
            assignedBookmarks: 2 // 1 pinned (left untouched) + 1 newly assigned
        }));
    });

    it('should skip orphaned clustering jobs when enqueue was not recorded', async () => {
        const job = createMockJob({ userId: 'user-7', pipelineRunId: 'run-17', jobGeneration: 17 });
        (shouldExecutePipelineClustering as any).mockResolvedValueOnce(false);

        await clusteringProcessor(job);

        expect(shouldExecutePipelineClustering).toHaveBeenCalledWith('user-7', 17, 'run-17');
        expect(recordPipelineClusteringCompleted).not.toHaveBeenCalled();
        expect(completePipelineRun).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
    });
});
