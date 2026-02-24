import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichmentProcessor } from '../enrichment';
import { supabase } from '../../db';
import { queues } from '../../lib/queue';
import { isUserCancelled } from '../../lib/cancellation';
import { Job } from 'bullmq';

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

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Enrichment Worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
        (isUserCancelled as any).mockReturnValue(false);
    });

    const createMockJob = (data: any) => ({
        data,
        updateProgress: vi.fn(),
    } as unknown as Job);

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
        mockFetch.mockResolvedValueOnce({
            text: () => Promise.resolve(mockHtml)
        });

        const job = createMockJob({
            userId: 'user-1',
            bookmarkId: 'bm-1',
            url: 'https://example.com'
        });

        await enrichmentProcessor(job);

        // Verify fetch was called
        expect(mockFetch).toHaveBeenCalledWith('https://example.com', expect.any(Object));

        // Verify Supabase update
        expect(supabase.from).toHaveBeenCalledWith('bookmarks');
        // The chained calls are a bit tricky to assert perfectly without deep mocks, 
        // but we can check if it was called at least.
        
        // Verify embedding queue
        expect(queues.embedding.add).toHaveBeenCalledWith(
            'embed',
            {
                userId: 'user-1',
                bookmarkId: 'bm-1',
                text: 'Test Title Test Description https://example.com',
                url: 'https://example.com',
            },
            expect.any(Object) // options
        );
    });

    it('should handle fetch failure gracefully and still enqueue with just URL', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const job = createMockJob({
            userId: 'user-2',
            bookmarkId: 'bm-2',
            url: 'https://broken.com'
        });

        await enrichmentProcessor(job);

        // Should still enqueue to embedding with empty title/desc
        expect(queues.embedding.add).toHaveBeenCalledWith(
            'embed',
            {
                userId: 'user-2',
                bookmarkId: 'bm-2',
                text: '  https://broken.com', // space space url
                url: 'https://broken.com',
            },
            expect.any(Object)
        );
    });

    it('should stop processing if cancelled before start', async () => {
        (isUserCancelled as any).mockReturnValueOnce(true);
        const job = createMockJob({ userId: 'user-3', bookmarkId: 'bm-3', url: 'https://test.com' });

        await enrichmentProcessor(job);

        expect(mockFetch).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
        expect(queues.embedding.add).not.toHaveBeenCalled();
    });
});
