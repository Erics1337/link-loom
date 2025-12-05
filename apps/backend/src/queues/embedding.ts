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
}

export const embeddingProcessor = async (job: Job<EmbeddingJobData>) => {
    const { bookmarkId, text } = job.data;
    console.log(`Embedding bookmark ${bookmarkId}`);

    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text.substring(0, 8000), // Truncate to avoid token limits
        });

        const vector = response.data[0].embedding;

        // Insert Embedding
        await db.insert(bookmarkEmbeddings).values({
            bookmarkId,
            vector,
        });

        // Update Status
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
