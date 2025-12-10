import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { supabase } from '../db';
import { createHash } from 'crypto';

interface IngestJobData {
    userId: string;
    bookmarks: {
        id: string; // Chrome ID
        url: string;
        title: string;
    }[];
}

export const ingestProcessor = async (job: Job<IngestJobData>) => {
    const { userId, bookmarks: rawBookmarks } = job.data;
    console.log(`[INGEST WORKER] Starting: ${rawBookmarks.length} bookmarks for user ${userId}`);

    try {
        // Ensure user exists (create if missing)
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('id', userId)
            .single();

        if (!existingUser) {
            console.log(`[INGEST WORKER] Creating user ${userId}`);
            await supabase.from('users').upsert({ id: userId }, { onConflict: 'id' });
        }

        let processed = 0;
        for (const b of rawBookmarks) {
            const urlHash = createHash('sha256').update(b.url).digest('hex');

            // 1. Ensure Shared Link Exists (Idempotent)
            await supabase
                .from('shared_links')
                .upsert({ id: urlHash, url: b.url }, { onConflict: 'id' });

            // 2. Insert Bookmark linked to Shared Link
            const { data: inserted, error } = await supabase
                .from('bookmarks')
                .upsert({
                    user_id: userId,
                    chrome_id: b.id,
                    url: b.url,
                    title: b.title,
                    content_hash: urlHash,
                    status: 'pending',
                }, { onConflict: 'chrome_id,user_id' })
                .select()
                .single();

            if (error || !inserted) {
                // Bookmark already exists or error, skip
                continue;
            }

            // 3. Check if Shared Link already has a vector (Cache Hit)
            const { data: shared } = await supabase
                .from('shared_links')
                .select('vector')
                .eq('id', urlHash)
                .single();

            if (shared?.vector) {
                console.log(`[INGEST WORKER] Cache HIT for ${b.url}`);
                // Mark as embedded immediately
                await supabase
                    .from('bookmarks')
                    .update({ status: 'embedded' })
                    .eq('id', inserted.id);
            } else {
                // Cache MISS - Add to Enrichment Queue
                await queues.enrichment.add('enrich', {
                    bookmarkId: inserted.id,
                    url: inserted.url,
                });
            }

            processed++;
            if (processed % 100 === 0) {
                console.log(`[INGEST WORKER] Processed ${processed}/${rawBookmarks.length}`);
            }
        }
        console.log(`[INGEST WORKER] Done: ${processed} bookmarks saved`);
    } catch (error) {
        console.error(`[INGEST WORKER] ERROR:`, error);
        throw error;
    }
};
