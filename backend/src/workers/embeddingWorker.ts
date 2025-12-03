import { Worker, Job } from 'bullmq';
import { connection } from '../queue/connection';
import { QUEUE_NAMES } from '../queue/queues';
import { OpenAIService } from '../services/openai';
import { query } from '../db/client';
import pgvector from 'pgvector/pg';

const openai = new OpenAIService();

export const embeddingWorker = new Worker(
    QUEUE_NAMES.EMBEDDING,
    async (job: Job) => {
        const { bookmarkId, text } = job.data;
        console.log(`[Embedding] Processing ${bookmarkId}`);

        try {
            const vector = await openai.generateEmbedding(text);
            const vectorStr = pgvector.toSql(vector);

            // Save to embeddings table
            await query(
                `INSERT INTO embeddings (bookmark_id, vector)
         VALUES ($1, $2)
         ON CONFLICT (bookmark_id) DO UPDATE SET vector = EXCLUDED.vector`,
                [bookmarkId, vectorStr]
            );

            // Update bookmark status
            await query(
                `UPDATE bookmarks SET status = 'EMBEDDED' WHERE id = $1`,
                [bookmarkId]
            );

            console.log(`[Embedding] Saved vector for ${bookmarkId}`);

        } catch (error: any) {
            console.error(`[Embedding] Failed for ${bookmarkId}:`, error);

            // If it's a rate limit error, rethrow so BullMQ retries with backoff
            if (error.status === 429 || (error.message && error.message.includes('Rate limit'))) {
                throw error;
            }

            await query(
                `UPDATE bookmarks SET status = 'ERROR' WHERE id = $1`,
                [bookmarkId]
            );
            throw error;
        }
    },
    {
        connection,
        concurrency: 2,
        limiter: {
            max: 2, // Max 2 jobs
            duration: 1000 // Per second
        }
    }
);
