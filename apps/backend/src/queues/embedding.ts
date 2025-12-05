import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { db } from '../db';
import { bookmarks, bookmarkEmbeddings } from '../db/schema';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface EmbeddingJobData {
    bookmarkId: string;
    text: string;
    url: string;
}

import { createHash } from 'crypto';
import { sharedLinks } from '../db/schema';

export const embeddingProcessor = async (job: Job<EmbeddingJobData>) => {
    const { bookmarkId, text, url } = job.data; // Ensure URL is passed in job data
    console.log(`Processing bookmark ${bookmarkId}`);

    try {
        // 1. Calculate Hash
        const urlHash = createHash('sha256').update(url).digest('hex');

        // 2. Check Shared Cache
        const [cached] = await db.select().from(sharedLinks).where(eq(sharedLinks.id, urlHash));

        let vector: number[];

        if (cached && cached.vector) {
            console.log(`Cache HIT for ${url}`);
            vector = cached.vector;
        } else {
            console.log(`Cache MISS for ${url} - Calling OpenAI`);
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: text.substring(0, 8000),
            });
            vector = response.data[0].embedding;

            // Save to Shared Cache
            await db.insert(sharedLinks).values({
                id: urlHash,
                url,
                vector,
            }).onConflictDoNothing();
        }

        // 3. Insert User Embedding
        await db.insert(bookmarkEmbeddings).values({
            bookmarkId,
            vector,
        }).onConflictDoNothing();

        // 4. Update Status
        await db.update(bookmarks)
            .set({ status: 'embedded' })
            .where(eq(bookmarks.id, bookmarkId));

    } catch (err) {
        console.error(`Failed to embed ${bookmarkId}`, err);
        await db.update(bookmarks)
            .set({ status: 'error' })
            .where(eq(bookmarks.id, bookmarkId));
    }
};
