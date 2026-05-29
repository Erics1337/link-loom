import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('queue contract', () => {
    it('returns explicit retry metadata for test-driver jobs', async () => {
        vi.stubEnv('QUEUE_DRIVER', 'test');
        const { queues } = await import('../queue');

        const job = await queues.ingest.add(
            'ingest',
            { userId: 'user-1' },
            { jobId: 'ingest-user-1-generation-3' }
        );

        expect(job).toEqual({
            id: 'ingest-user-1-generation-3',
            data: { userId: 'user-1' },
            attempts: 5,
            backoffMs: 30000,
        });
    });

    it('parses queued messages with retry metadata', async () => {
        const { parseQueuedMessage } = await import('../queue');
        const message = parseQueuedMessage(JSON.stringify({
            queue: 'embedding',
            jobName: 'embed',
            data: { bookmarkId: 'bookmark-1' },
            jobId: 'embed-user-generation-2-bookmark-1',
            attempts: 5,
            backoffMs: 30000,
        }));

        expect(message).toMatchObject({
            queue: 'embedding',
            jobName: 'embed',
            jobId: 'embed-user-generation-2-bookmark-1',
            attempts: 5,
            backoffMs: 30000,
        });
    });
});
