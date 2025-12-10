import { Job } from 'bullmq';
import { supabase } from '../db';
import OpenAI from 'openai';
import { createHash } from 'crypto';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface EmbeddingJobData {
    bookmarkId: string;
    text: string;
    url: string;
}

export const embeddingProcessor = async (job: Job<EmbeddingJobData>) => {
    const { bookmarkId, text, url } = job.data;
    console.log(`Processing bookmark ${bookmarkId}`);

    try {
        // 1. Calculate Hash
        const urlHash = createHash('sha256').update(url).digest('hex');

        // 2. Check Shared Cache
        const { data: cached } = await supabase
            .from('shared_links')
            .select('vector')
            .eq('id', urlHash)
            .single();

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
            await supabase
                .from('shared_links')
                .update({ vector })
                .eq('id', urlHash);
        }

        // 3. Update Status
        await supabase
            .from('bookmarks')
            .update({ status: 'embedded' })
            .eq('id', bookmarkId);

    } catch (err) {
        console.error(`Failed to embed ${bookmarkId}`, err);
        await supabase
            .from('bookmarks')
            .update({ status: 'error' })
            .eq('id', bookmarkId);
    }
};
