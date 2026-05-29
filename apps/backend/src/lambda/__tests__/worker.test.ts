import { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const upsert = vi.fn();
    const update = vi.fn();
    const eq = vi.fn();
    const from = vi.fn((table: string) => {
        if (table === 'queue_job_failures') {
            return { upsert };
        }
        if (table === 'bookmarks') {
            return { update };
        }
        throw new Error(`Unexpected table ${table}`);
    });

    return {
        from,
        upsert,
        update,
        eq,
        ingestProcessor: vi.fn(),
        enrichmentProcessor: vi.fn(),
        embeddingProcessor: vi.fn(),
        clusteringProcessor: vi.fn(),
    };
});

vi.mock('../../db', () => ({
    supabase: {
        from: mocks.from,
    },
}));

vi.mock('../../queues/ingest', () => ({ ingestProcessor: mocks.ingestProcessor }));
vi.mock('../../queues/enrichment', () => ({ enrichmentProcessor: mocks.enrichmentProcessor }));
vi.mock('../../queues/embedding', () => ({ embeddingProcessor: mocks.embeddingProcessor }));
vi.mock('../../queues/clustering', () => ({ clusteringProcessor: mocks.clusteringProcessor }));

const createEvent = (body: unknown, receiveCount: string): SQSEvent => ({
    Records: [{
        messageId: 'message-1',
        body: JSON.stringify(body),
        attributes: {
            ApproximateReceiveCount: receiveCount,
        },
    }],
} as SQSEvent);

describe('lambda queue worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.upsert.mockResolvedValue({ error: null });
        mocks.eq.mockResolvedValue({ error: null });
        mocks.update.mockReturnValue({ eq: mocks.eq });
    });

    it('records exhausted queue failures and marks bookmark-scoped jobs as errored', async () => {
        const { processEvent } = await import('../worker');
        mocks.enrichmentProcessor.mockRejectedValueOnce(new Error('scrape exploded'));

        const result = await processEvent('enrichment', createEvent({
            queue: 'enrichment',
            jobName: 'enrich',
            jobId: 'enrich-user-1-generation-4-bookmark-1',
            attempts: 3,
            backoffMs: 30000,
            data: {
                userId: '00000000-0000-0000-0000-000000000001',
                bookmarkId: '00000000-0000-0000-0000-000000000002',
            },
        }, '3'));

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'message-1' }] });
        expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
            queue_name: 'enrichment',
            job_id: 'enrich-user-1-generation-4-bookmark-1',
            job_name: 'enrich',
            user_id: '00000000-0000-0000-0000-000000000001',
            bookmark_id: '00000000-0000-0000-0000-000000000002',
            attempts: 3,
            receive_count: 3,
            error_message: 'scrape exploded',
        }), { onConflict: 'queue_name,job_id' });
        expect(mocks.update).toHaveBeenCalledWith({ status: 'error' });
        expect(mocks.eq).toHaveBeenCalledWith('id', '00000000-0000-0000-0000-000000000002');
    });

    it('keeps retrying failed jobs until their configured attempts are exhausted', async () => {
        const { processEvent } = await import('../worker');
        mocks.embeddingProcessor.mockRejectedValueOnce(new Error('rate limited'));

        const result = await processEvent('embedding', createEvent({
            queue: 'embedding',
            jobName: 'embed',
            jobId: 'embed-user-1-generation-4-bookmark-1',
            attempts: 5,
            backoffMs: 30000,
            data: {
                userId: '00000000-0000-0000-0000-000000000001',
                bookmarkId: '00000000-0000-0000-0000-000000000002',
            },
        }, '2'));

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'message-1' }] });
        expect(mocks.upsert).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
