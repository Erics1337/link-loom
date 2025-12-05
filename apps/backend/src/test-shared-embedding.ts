import { embeddingProcessor } from './queues/embedding';
import { db } from './db';
import { bookmarks, sharedLinks, bookmarkEmbeddings, users } from './db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// Mock Job
const bookmarkId = randomUUID();
const userId = randomUUID();
const mockJob = {
    data: {
        bookmarkId,
        text: 'Test content for shared embedding',
        url: 'https://example.com/shared-test',
    }
} as any;

async function runTest() {
    console.log('Starting Shared Embedding Test...');

    // 1. Cleanup previous test data
    // await db.delete(bookmarks).where(eq(bookmarks.id, 'test-bookmark-id')); // No need to cleanup random IDs
    await db.delete(sharedLinks).where(eq(sharedLinks.url, 'https://example.com/shared-test'));

    // 2. Create dummy user and bookmark
    await db.insert(users).values({
        id: userId,
        email: `test-${randomUUID()}@example.com`,
    });

    await db.insert(bookmarks).values({
        id: bookmarkId,
        userId: userId,
        chromeId: 'test-chrome-id',
        url: 'https://example.com/shared-test',
        title: 'Test Shared',
        status: 'enriched',
    });

    // 3. Run Processor (First Run - Should call OpenAI)
    console.log('\n--- First Run (Cache Miss) ---');
    await embeddingProcessor(mockJob);

    // Verify it's in shared_links
    const [shared] = await db.select().from(sharedLinks).where(eq(sharedLinks.url, 'https://example.com/shared-test'));
    if (shared) {
        console.log('SUCCESS: Embedding saved to shared cache.');
    } else {
        console.error('FAILURE: Embedding NOT saved to shared cache.');
    }

    // 4. Run Processor Again (Second Run - Should Hit Cache)
    console.log('\n--- Second Run (Cache Hit) ---');
    // We can't easily mock OpenAI here to prove it wasn't called without dependency injection,
    // but we can check the logs if we run this.
    await embeddingProcessor(mockJob);

    console.log('Test Complete.');
    process.exit(0);
}

runTest().catch(console.error);
