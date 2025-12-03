import { Worker, Job } from 'bullmq';
import { connection } from '../queue/connection';
import { QUEUE_NAMES, embeddingQueue } from '../queue/queues';
import { OpenAIService } from '../services/openai';
import { query } from '../db/client';

const openai = new OpenAIService();

export const renamingWorker = new Worker(
    QUEUE_NAMES.RENAMING,
    async (job: Job) => {
        const { bookmarkId, content } = job.data;
        console.log(`[Renaming] Processing ${bookmarkId}`);

        if (!content || content.trim().length === 0) {
            console.log(`[Renaming] No content for ${bookmarkId}, skipping rename.`);
            // Even if we skip rename, we might want to embed? 
            // But if content is empty, embedding will fail. 
            // Assuming enrichment guarantees content, this is just a safety check.
            return;
        }

        try {
            // Generate a better title using OpenAI
            // We let this throw so BullMQ can retry on transient errors (e.g. Rate Limits)
            const newTitle = await openai.generateTitle(content);

            if (newTitle && newTitle.length > 0) {
                // First, check if we need to save the original title
                const currentRow = await query(
                    `SELECT title, original_title FROM bookmarks WHERE id = $1`,
                    [bookmarkId]
                );

                // If original_title is null, save the current title as original
                if (currentRow.rows.length > 0 && !currentRow.rows[0].original_title) {
                    await query(
                        `UPDATE bookmarks SET original_title = title WHERE id = $1`,
                        [bookmarkId]
                    );
                }

                // Update bookmark title with AI-generated one
                await query(
                    `UPDATE bookmarks SET title = $1 WHERE id = $2`,
                    [newTitle, bookmarkId]
                );

                console.log(`[Renaming] Updated title for ${bookmarkId}: "${newTitle}"`);
            } else {
                console.log(`[Renaming] No title generated for ${bookmarkId}, keeping original`);
            }
        } catch (error: any) {
            console.error(`[Renaming] Error generating title for ${bookmarkId}:`, error);

            // If it's a rate limit error, rethrow so BullMQ retries with backoff
            if (error.status === 429 || (error.message && error.message.includes('Rate limit'))) {
                throw error;
            }

            // For other errors, we proceed to embedding so the pipeline doesn't get stuck
        }

        // Proceed to embedding
        console.log(`[Renaming] Queueing embedding for ${bookmarkId}`);
        await embeddingQueue.add('embed', {
            bookmarkId,
            text: content
        });
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
