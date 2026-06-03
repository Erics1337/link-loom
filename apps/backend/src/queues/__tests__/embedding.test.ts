import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embeddingProcessor } from '../embedding';
import { supabase } from '../../db';
import { isUserCancelled } from '../../lib/cancellation';
import { notifyPipelineBookmarkTerminal } from '../../lib/pipelineCoordinator';
import { QueueJob } from '../../lib/queue';

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn(),
    }
}));

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            embeddings = {
                create: mockCreate
            };
        }
    };
});

vi.mock('../../lib/cancellation', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../lib/cancellation')>();
    return {
        ...actual,
        isUserCancelled: vi.fn(),
    };
});

vi.mock('../../lib/pipelineCoordinator', () => ({
    notifyPipelineBookmarkTerminal: vi.fn(),
}));

const createMockChain = (resolvedValue: any) => {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(resolvedValue),
        update: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve(resolvedValue)
    };
    return chain;
};

describe('Embedding Worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreate.mockReset();
        (isUserCancelled as any).mockReturnValue(false);
    });

    const createMockJob = (data: any) => ({
        data,
    } as unknown as QueueJob<any>);

    it('should correctly process a cache MISS, call OpenAI, and cache the result', async () => {
        const job = createMockJob({
            userId: 'user-1',
            pipelineRunId: 'run-6',
            jobGeneration: 6,
            bookmarkId: 'bm-1',
            text: 'Test content',
            url: 'https://example.com'
        });

        const mockSharedLinksChain = createMockChain({ data: null, error: null }); // cache miss
        const mockBookmarksChain = createMockChain({ error: null });

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'shared_links') return mockSharedLinksChain;
            if (table === 'bookmarks') return mockBookmarksChain;
            return {};
        });

        mockCreate.mockResolvedValueOnce({
            data: [{ embedding: [0.1, 0.2, 0.3] }]
        });

        await embeddingProcessor(job);

        expect(supabase.from).toHaveBeenCalledWith('shared_links');
        
        expect(mockCreate).toHaveBeenCalledWith({
            model: 'text-embedding-3-small',
            input: 'Test content',
        });

        // Verify we saved to shared cache
        expect(mockSharedLinksChain.update).toHaveBeenCalledWith({
            vector: [0.1, 0.2, 0.3]
        });

        // Verify bookmark status updated
        expect(mockBookmarksChain.update).toHaveBeenCalledWith({
            status: 'embedded'
        });
        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-1',
            6,
            'run-6',
            'bm-1',
            expect.any(Object)
        );
        expect(isUserCancelled).toHaveBeenCalledWith('user-1', 6, 'run-6', expect.any(Object));
    });

    it('should correctly process a cache HIT and skip OpenAI', async () => {
        const job = createMockJob({
            userId: 'user-2',
            pipelineRunId: 'run-7',
            jobGeneration: 7,
            bookmarkId: 'bm-2',
            text: 'More test content',
            url: 'https://cached.com'
        });

        const cachedVector = [0.9, 0.8, 0.7];
        const mockSharedLinksChain = createMockChain({ data: { vector: cachedVector }, error: null }); // cache HIT
        const mockBookmarksChain = createMockChain({ error: null });

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'shared_links') return mockSharedLinksChain;
            if (table === 'bookmarks') return mockBookmarksChain;
            return {};
        });

        await embeddingProcessor(job);

        expect(mockCreate).not.toHaveBeenCalled();

        // Verify bookmark status updated
        expect(mockBookmarksChain.update).toHaveBeenCalledWith({
            status: 'embedded'
        });
        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-2',
            7,
            'run-7',
            'bm-2',
            expect.any(Object)
        );
        expect(isUserCancelled).toHaveBeenCalledTimes(2);
        expect(isUserCancelled).toHaveBeenNthCalledWith(1, 'user-2', 7, 'run-7', expect.any(Object));
        expect(isUserCancelled).toHaveBeenNthCalledWith(2, 'user-2', 7, 'run-7', expect.any(Object));
    });

    it('should abort if cancelled before processing', async () => {
        (isUserCancelled as any).mockReturnValueOnce(true);
        const job = createMockJob({
            userId: 'user-3',
            pipelineRunId: 'run-8',
            jobGeneration: 8,
            bookmarkId: 'bm-3',
            text: 'x',
            url: 'y'
        });

        await embeddingProcessor(job);

        expect(supabase.from).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-3',
            8,
            'run-8',
            'bm-3',
            expect.any(Object)
        );
    });

    it('should notify and abort if cancelled before status update', async () => {
        (isUserCancelled as any)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

        const job = createMockJob({
            userId: 'user-4',
            pipelineRunId: 'run-9',
            jobGeneration: 9,
            bookmarkId: 'bm-4',
            text: 'Cached content',
            url: 'https://cached-before-status.com'
        });

        const mockSharedLinksChain = createMockChain({ data: { vector: [0.4, 0.5] }, error: null });
        const mockBookmarksChain = createMockChain({ error: null });

        (supabase.from as any).mockImplementation((table: string) => {
            if (table === 'shared_links') return mockSharedLinksChain;
            if (table === 'bookmarks') return mockBookmarksChain;
            return {};
        });

        await embeddingProcessor(job);

        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockBookmarksChain.update).not.toHaveBeenCalled();
        expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
            'user-4',
            9,
            'run-9',
            'bm-4',
            expect.any(Object)
        );
    });

    it('should retry when cancellation evaluation fails', async () => {
        const cancellationError = new Error('database unavailable');
        (isUserCancelled as any).mockRejectedValueOnce(cancellationError);
        const job = createMockJob({
            userId: 'user-5',
            pipelineRunId: 'run-10',
            jobGeneration: 10,
            bookmarkId: 'bm-5',
            text: 'x',
            url: 'y'
        });

        await expect(embeddingProcessor(job)).rejects.toThrow('database unavailable');

        expect(supabase.from).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(notifyPipelineBookmarkTerminal).not.toHaveBeenCalled();
    });
});
