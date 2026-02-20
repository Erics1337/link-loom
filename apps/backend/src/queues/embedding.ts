import { Job } from 'bullmq';
import { supabase } from '../db';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import { isUserCancelled } from '../lib/cancellation';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface EmbeddingJobData {
    userId: string;
    bookmarkId: string;
    text: string;
    url: string;
}

export const embeddingProcessor = async (job: Job<EmbeddingJobData>) => {
    const { userId, bookmarkId, text, url } = job.data;
    console.log(`Processing bookmark ${bookmarkId}`);

    try {
        if (isUserCancelled(userId)) {
            console.log(`[EMBEDDING] Cancelled before start for user ${userId}`);
            return;
        }

        // 1. Calculate Hash
        const urlHash = createHash('sha256').update(url).digest('hex');

        // 2. Check Shared Cache
        const { data: cached, error: cacheLookupError } = await supabase
            .from('shared_links')
            .select('vector')
            .eq('id', urlHash)
            .single();
        if (cacheLookupError) {
            throw new Error(`Shared link lookup failed for ${url}: ${cacheLookupError.message}`);
        }

        let vector: number[];

        if (cached?.vector) {
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
            const { error: sharedUpdateError } = await supabase
                .from('shared_links')
                .update({ vector })
                .eq('id', urlHash);
            if (sharedUpdateError) {
                throw new Error(`Failed to persist shared vector for ${url}: ${sharedUpdateError.message}`);
            }
        }

        // 3. Update Status
        if (isUserCancelled(userId)) {
            console.log(`[EMBEDDING] Cancelled before status update for user ${userId}`);
            return;
        }

        const { error: bookmarkStatusError } = await supabase
            .from('bookmarks')
            .update({ status: 'embedded' })
            .eq('id', bookmarkId);
        if (bookmarkStatusError) {
            throw new Error(`Failed to mark bookmark ${bookmarkId} as embedded: ${bookmarkStatusError.message}`);
        }

    } catch (err) {
        console.error(`Failed to embed ${bookmarkId}`, err);
        await supabase
            .from('bookmarks')
            .update({ status: 'error' })
            .eq('id', bookmarkId);
    }
};
