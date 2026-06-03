import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../db';
import { queues } from '../../lib/queue';
import { recoverStalePipelineState } from '../clustering/pipelineRecovery';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

vi.mock('../../lib/queue', () => ({
    queues: {
        enrichment: { add: vi.fn() },
        embedding: { add: vi.fn() },
    },
}));

const createQuery = (result: unknown) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
});

describe('recoverStalePipelineState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('propagates jobGeneration to recovered enrichment and embedding jobs', async () => {
        const log = vi.fn();
        const query = createQuery({
            data: [
                {
                    id: 'bookmark-pending',
                    status: 'pending',
                    url: 'https://example.com/pending',
                    shared_links: null,
                },
                {
                    id: 'bookmark-enriched',
                    status: 'enriched',
                    title: 'Example',
                    description: 'Recovered',
                    url: 'https://example.com/enriched',
                    shared_links: null,
                },
            ],
            error: null,
        });
        (supabase.from as any).mockReturnValue(query);

        await recoverStalePipelineState('user-1', 'run-9', 9, log);

        expect(queues.enrichment.add).toHaveBeenCalledWith('enrich', {
            userId: 'user-1',
            pipelineRunId: 'run-9',
            jobGeneration: 9,
            bookmarkId: 'bookmark-pending',
            url: 'https://example.com/pending',
        });
        expect(queues.embedding.add).toHaveBeenCalledWith('embed', {
            userId: 'user-1',
            pipelineRunId: 'run-9',
            jobGeneration: 9,
            bookmarkId: 'bookmark-enriched',
            url: 'https://example.com/enriched',
            text: 'Example Recovered https://example.com/enriched',
        });
    });
});
