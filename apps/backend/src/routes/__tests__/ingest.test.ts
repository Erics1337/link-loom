import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../db';
import { beginUserPipelineRun, markUserCancelled } from '../../lib/cancellation';
import { recordPipelineRunStarted } from '../../lib/pipelineCoordinator';
import { queues } from '../../lib/queue';
import { ensureUserExists, getUserPremiumStatus } from '../../lib/userContext';
import { registerIngestRoutes } from '../ingest';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
        rpc: vi.fn(),
    },
}));

vi.mock('../../lib/cancellation', () => ({
    beginUserPipelineRun: vi.fn(),
    markUserCancelled: vi.fn(),
}));

vi.mock('../../lib/pipelineCoordinator', () => ({
    recordPipelineRunStarted: vi.fn(),
}));

vi.mock('../../lib/queue', () => ({
    queues: {
        clustering: { add: vi.fn() },
        ingest: { add: vi.fn() },
    },
}));

vi.mock('../../lib/userContext', () => ({
    ensureUserExists: vi.fn(),
    FREE_TIER_LIMIT: 500,
    getUserPremiumStatus: vi.fn(),
    requireRequestUserId: vi.fn().mockResolvedValue('user-1'),
}));

describe('ingest routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (beginUserPipelineRun as any).mockResolvedValue({ id: 'run-1', generation: 1 });
    });

    it('records settings and totals for manually triggered clustering runs', async () => {
        const handlers = new Map<string, Function>();
        const fastify = {
            post: vi.fn((path: string, _options: unknown, handler: Function) => {
                handlers.set(path, handler);
            }),
        };
        const countChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 42, error: null }),
        };
        (supabase.from as any).mockReturnValue(countChain);

        await registerIngestRoutes(fastify as any);
        const handler = handlers.get('/trigger-clustering/:userId');
        const response = await handler?.(
            { body: { clusteringSettings: { folderDensity: 'more', namingTone: 'playful' } } },
            {}
        );

        expect(response).toEqual({ status: 'clustering_queued' });
        expect(recordPipelineRunStarted).toHaveBeenCalledWith(
            'user-1',
            1,
            42,
            expect.objectContaining({
                folderDensity: 'more',
                namingTone: 'playful',
            })
        );
        expect(queues.clustering.add).toHaveBeenCalledWith(
            'cluster',
            expect.objectContaining({
                userId: 'user-1',
                pipelineRunId: 'run-1',
                clusteringSettings: expect.objectContaining({ folderDensity: 'more' }),
            }),
            { jobId: 'cluster-user-1-manual-run-run-1' }
        );
    });

    it('does not create a manual clustering run when bookmark counting fails', async () => {
        const handlers = new Map<string, Function>();
        const fastify = {
            post: vi.fn((path: string, _options: unknown, handler: Function) => {
                handlers.set(path, handler);
            }),
        };
        const countChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'count failed' } }),
        };
        const reply = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn((payload: unknown) => payload),
        };
        (supabase.from as any).mockReturnValue(countChain);

        await registerIngestRoutes(fastify as any);
        const handler = handlers.get('/trigger-clustering/:userId');
        const response = await handler?.({ body: {} }, reply);

        expect(response).toEqual({ error: 'Failed to initialize clustering run' });
        expect(reply.code).toHaveBeenCalledWith(500);
        expect(beginUserPipelineRun).not.toHaveBeenCalled();
        expect(recordPipelineRunStarted).not.toHaveBeenCalled();
        expect(queues.clustering.add).not.toHaveBeenCalled();
    });

    it('starts a pipeline run and queues ingest for /ingest', async () => {
        const handlers = new Map<string, Function>();
        const fastify = {
            post: vi.fn((path: string, _options: unknown, handler: Function) => {
                handlers.set(path, handler);
            }),
        };
        const bookmarks = [{ url: 'https://example.com', title: 'Example' }];
        (ensureUserExists as any).mockResolvedValue(null);
        (getUserPremiumStatus as any).mockResolvedValue(true);
        (supabase.rpc as any).mockResolvedValue({ error: null });

        await registerIngestRoutes(fastify as any);
        const handler = handlers.get('/ingest');
        const response = await handler?.({
            body: {
                bookmarks,
                clusteringSettings: { folderDensity: 'more', namingTone: 'playful' },
            },
        }, {});

        expect(response).toEqual({ status: 'queued' });
        expect(beginUserPipelineRun).toHaveBeenCalledWith('user-1');
        expect(recordPipelineRunStarted).toHaveBeenCalledWith(
            'user-1',
            1,
            1,
            expect.objectContaining({
                folderDensity: 'more',
                namingTone: 'playful',
            })
        );
        expect(supabase.rpc).toHaveBeenCalledWith('clear_user_ingest_structure', {
            p_user_id: 'user-1',
        });
        expect(queues.ingest.add).toHaveBeenCalledWith(
            'ingest',
            expect.objectContaining({
                userId: 'user-1',
                bookmarks,
                pipelineRunId: 'run-1',
                clusteringSettings: expect.objectContaining({ folderDensity: 'more' }),
            }),
            { jobId: 'ingest-user-1-run-run-1' }
        );
    });

    it('marks the user cancelled and resets bookmark status for /cancel/:userId', async () => {
        const handlers = new Map<string, Function>();
        const fastify = {
            post: vi.fn((path: string, _options: unknown, handler: Function) => {
                handlers.set(path, handler);
            }),
        };
        const updateChain = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ error: null }),
        };
        (supabase.from as any).mockReturnValue(updateChain);

        await registerIngestRoutes(fastify as any);
        const handler = handlers.get('/cancel/:userId');
        const response = await handler?.({}, {});

        expect(response).toEqual({ status: 'cancelled' });
        expect(markUserCancelled).toHaveBeenCalledWith('user-1');
        expect(updateChain.update).toHaveBeenCalledWith({ status: 'idle' });
        expect(updateChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
        expect(updateChain.in).toHaveBeenCalledWith('status', ['pending', 'enriched']);
    });

    it('returns an error when /cancel/:userId fails to reset bookmark status', async () => {
        const handlers = new Map<string, Function>();
        const fastify = {
            post: vi.fn((path: string, _options: unknown, handler: Function) => {
                handlers.set(path, handler);
            }),
        };
        const updateChain = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ error: { message: 'update failed' } }),
        };
        const reply = {
            code: vi.fn().mockReturnThis(),
            send: vi.fn((payload: unknown) => payload),
        };
        (supabase.from as any).mockReturnValue(updateChain);

        await registerIngestRoutes(fastify as any);
        const handler = handlers.get('/cancel/:userId');
        const response = await handler?.({}, reply);

        expect(response).toEqual({ error: 'Failed to reset status' });
        expect(reply.code).toHaveBeenCalledWith(500);
        expect(markUserCancelled).toHaveBeenCalledWith('user-1');
    });
});
