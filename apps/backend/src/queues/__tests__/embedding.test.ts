import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embeddingProcessor } from '../embedding';
import { supabase } from '../../db';
import { isUserCancelled } from '../../lib/cancellation';
import { Job } from 'bullmq';

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

vi.mock('../../lib/cancellation', () => ({
    isUserCancelled: vi.fn()
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
    } as unknown as Job);

    it('should correctly process a cache MISS, call OpenAI, and cache the result', async () => {
        const job = createMockJob({
            userId: 'user-1',
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
    });

    it('should correctly process a cache HIT and skip OpenAI', async () => {
        const job = createMockJob({
            userId: 'user-2',
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
    });

    it('should abort if cancelled before processing', async () => {
        (isUserCancelled as any).mockReturnValueOnce(true);
        const job = createMockJob({ userId: 'user-3', bookmarkId: 'bm-3', text: 'x', url: 'y' });

        await embeddingProcessor(job);

        expect(supabase.from).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
