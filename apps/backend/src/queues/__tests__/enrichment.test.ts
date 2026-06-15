import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichmentProcessor } from '../enrichment';
import { supabase } from '../../db';
import { queues } from '../../lib/queue';
import { isUserCancelled } from '../../lib/cancellation';
import { notifyPipelineBookmarkTerminal } from '../../lib/pipelineCoordinator';
import { QueueJob } from '../../lib/queue';
import { safeFetch } from '../../lib/safeFetch';

// Mock dependencies
vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(() => ({
            update: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ error: null })
            }))
        }))
    }
}));

vi.mock('../../lib/queue', () => ({
    queues: {
        embedding: {
            add: vi.fn()
        }
    }
}));

vi.mock('../../lib/cancellation', () => ({
    isUserCancelled: vi.fn()
}));

vi.mock('../../lib/pipelineCoordinator', () => ({
    notifyPipelineBookmarkTerminal: vi.fn(),
}));

vi.mock('../../lib/safeFetch', () => ({
    safeFetch: vi.fn()
}));

describe('Enrichment Worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (safeFetch as any).mockReset();
        (isUserCancelled as any).mockReturnValue(false);
    });

    const createMockJob = (data: any) => ({
        data,
        updateProgress: vi.fn(),
    } as unknown as QueueJob<any>);

    it('should successfully fetch URL, extract metadata, update DB, and enqueue embedding', async () => {
        const mockHtml = `
            <html>
                <head>
                    <title>Test Title</title>
                    <meta name="description" content="Test Description">
                </head>
                <body></body>
            </html>
        `;
        (safeFetch as any).mockResolvedValueOnce({
            text: () => Promise.resolve(mockHtml)
        });

        const job = createMockJob({
            userId: 'user-1',
            pipelineRunId: 'run-4',
            jobGeneration: 4,
            bookmarkId: 'bm-1',
            url: 'https://example.com'
        });

        await enrichmentProcessor(job);

        // Verify fetch was called
        expect(safeFetch).toHaveBeenCalledWith('https://example.com', { timeoutMs: 5000 });

        // Verify Supabase update
        expect(supabase.from).toHaveBeenCalledWith('bookmarks');
        // The chained calls are a bit tricky to assert perfectly without deep mocks, 
        // but we can check if it was called at least.
        
        // Verify embedding queue
        expect(queues.embedding.add).toHaveBeenCalledWith(
            'embed',
            expect.objectContaining({
                userId: 'user-1',
                pipelineRunId: 'run-4',
                bookmarkId: 'bm-1',
                url: 'https://example.com',
            }),
            { jobId: 'embed-user-1-run-run-4-bm-1' }
        );
        expect(isUserCancelled).toHaveBeenCalledWith('user-1', 4, 'run-4');
    });

    it('should handle fetch failure gracefully and still enqueue with just URL', async () => {
        (safeFetch as any).mockRejectedValueOnce(new Error('Network error'));

        const job = createMockJob({
            userId: 'user-2',
            pipelineRunId: 'run-5',
            jobGeneration: 5,
            bookmarkId: 'bm-2',
            url: 'https://broken.com'
        });

        await enrichmentProcessor(job);

        // Should still enqueue to embedding with empty title/desc
        expect(queues.embedding.add).toHaveBeenCalledWith(
            'embed',
            expect.objectContaining({
                userId: 'user-2',
                pipelineRunId: 'run-5',
                bookmarkId: 'bm-2',
                url: 'https://broken.com',
            }),
            { jobId: 'embed-user-2-run-run-5-bm-2' }
        );
        expect(isUserCancelled).toHaveBeenCalledTimes(3);
        expect(isUserCancelled).toHaveBeenNthCalledWith(1, 'user-2', 5, 'run-5');
        expect(isUserCancelled).toHaveBeenNthCalledWith(2, 'user-2', 5, 'run-5');
        expect(isUserCancelled).toHaveBeenNthCalledWith(3, 'user-2', 5, 'run-5');
    });

    it('should stop processing if cancelled before start', async () => {
        (isUserCancelled as any).mockReturnValueOnce(true);
        const job = createMockJob({
            userId: 'user-3',
            pipelineRunId: 'run-6',
            jobGeneration: 6,
            bookmarkId: 'bm-3',
            url: 'https://test.com'
        });

        await enrichmentProcessor(job);

        expect(safeFetch).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
        expect(queues.embedding.add).not.toHaveBeenCalled();
        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-3',
            6,
            'run-6',
            'bm-3',
            expect.any(Object)
        );
    });

    it('should notify and stop processing if cancelled after fetch', async () => {
        (isUserCancelled as any)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        (safeFetch as any).mockResolvedValueOnce({
            text: () => Promise.resolve('<html><head><title>Fetched</title></head></html>')
        });
        const job = createMockJob({
            userId: 'user-4',
            pipelineRunId: 'run-7',
            jobGeneration: 7,
            bookmarkId: 'bm-4',
            url: 'https://test.com'
        });

        await enrichmentProcessor(job);

        expect(safeFetch).toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
        expect(queues.embedding.add).not.toHaveBeenCalled();
        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-4',
            7,
            'run-7',
            'bm-4',
            expect.any(Object)
        );
    });

    it('should notify and stop processing if cancelled before embedding enqueue', async () => {
        (isUserCancelled as any)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        (safeFetch as any).mockResolvedValueOnce({
            text: () => Promise.resolve('<html><head><title>Fetched</title></head></html>')
        });
        const job = createMockJob({
            userId: 'user-5',
            pipelineRunId: 'run-8',
            jobGeneration: 8,
            bookmarkId: 'bm-5',
            url: 'https://test.com'
        });

        await enrichmentProcessor(job);

        expect(supabase.from).toHaveBeenCalledWith('bookmarks');
        expect(queues.embedding.add).not.toHaveBeenCalled();
        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-5',
            8,
            'run-8',
            'bm-5',
            expect.any(Object)
        );
    });

    it('should use a unique embedding job id when pipeline run metadata is missing', async () => {
        (safeFetch as any).mockResolvedValueOnce({
            text: () => Promise.resolve('<html><head><title>Legacy</title></head></html>')
        });

        const job = createMockJob({
            userId: 'user-legacy',
            bookmarkId: 'bm-legacy',
            url: 'https://legacy.example'
        });

        await enrichmentProcessor(job);

        const addCall = (queues.embedding.add as any).mock.calls[0];
        expect(addCall[2].jobId).toMatch(
            /^embed-user-legacy-bm-legacy-[0-9a-f-]{36}$/
        );
        expect(addCall[2].jobId).not.toContain('-run-legacy-');
    });

    it('should prefer pipelineRunId over jobGeneration in the embedding job id', async () => {
        (safeFetch as any).mockResolvedValueOnce({
            text: () => Promise.resolve('<html><head><title>Run</title></head></html>')
        });

        const job = createMockJob({
            userId: 'user-7',
            pipelineRunId: 'run-10',
            jobGeneration: 10,
            bookmarkId: 'bm-7',
            url: 'https://run.example'
        });

        await enrichmentProcessor(job);

        expect(queues.embedding.add).toHaveBeenCalledWith(
            'embed',
            expect.objectContaining({
                bookmarkId: 'bm-7',
            }),
            { jobId: 'embed-user-7-run-run-10-bm-7' }
        );
    });

    it('should continue when pipeline notification fails after enrichment DB update error', async () => {
        const updateError = { message: 'write failed' };
        const notifyError = new Error('rpc unavailable');
        const eq = vi
            .fn()
            .mockResolvedValueOnce({ error: updateError })
            .mockResolvedValueOnce({ error: null });
        const update = vi.fn(() => ({ eq }));
        (supabase.from as any).mockReturnValue({ update });
        (safeFetch as any).mockResolvedValueOnce({
            text: () => Promise.resolve('<html><head><title>Title</title></head></html>')
        });
        (notifyPipelineBookmarkTerminal as any).mockRejectedValueOnce(notifyError);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const job = createMockJob({
            userId: 'user-8',
            pipelineRunId: 'run-11',
            jobGeneration: 11,
            bookmarkId: 'bm-8',
            url: 'https://db-error.example'
        });

        await expect(enrichmentProcessor(job)).resolves.toBeUndefined();

        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-8',
            11,
            'run-11',
            'bm-8',
            expect.any(Object)
        );
        expect(queues.embedding.add).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
            '[ENRICHMENT] Failed to notify pipeline terminal state for bookmark bm-8 (jobGeneration=11, pipelineRunId=run-11)',
            notifyError
        );

        errorSpy.mockRestore();
    });

    it('should retry when cancellation evaluation fails', async () => {
        const cancellationError = new Error('database unavailable');
        (isUserCancelled as any).mockRejectedValueOnce(cancellationError);
        const job = createMockJob({
            userId: 'user-6',
            pipelineRunId: 'run-9',
            jobGeneration: 9,
            bookmarkId: 'bm-6',
            url: 'https://test.com'
        });

        await expect(enrichmentProcessor(job)).rejects.toThrow('database unavailable');

        expect(safeFetch).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
        expect(queues.embedding.add).not.toHaveBeenCalled();
        expect(notifyPipelineBookmarkTerminal).not.toHaveBeenCalled();
    });
});
