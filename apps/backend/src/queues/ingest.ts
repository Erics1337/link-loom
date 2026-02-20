import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { supabase } from '../db';
import { createHash } from 'crypto';
import { isUserCancelled } from '../lib/cancellation';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';

interface IngestJobData {
    userId: string;
    bookmarks: {
        id: string; // Chrome ID
        url: string;
        title: string;
    }[];
    clusteringSettings?: ClusteringSettings;
}

export const ingestProcessor = async (job: Job<IngestJobData>) => {
    const { userId, bookmarks: rawBookmarks } = job.data;
    const clusteringSettings = normalizeClusteringSettings(job.data.clusteringSettings);
    console.log(`[INGEST WORKER] Starting: ${rawBookmarks.length} bookmarks for user ${userId}`);

    try {
        if (isUserCancelled(userId)) {
            console.log(`[INGEST WORKER] Cancelled before start for user ${userId}`);
            return;
        }

        await job.updateProgress({ processed: 0, total: rawBookmarks.length });

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

        let saved = 0;
        let handled = 0;
        for (const b of rawBookmarks) {
            if (isUserCancelled(userId)) {
                console.log(`[INGEST WORKER] Cancelled during ingest for user ${userId}`);
                return;
            }

            handled++;
            const urlHash = createHash('sha256').update(b.url).digest('hex');

            // 1. Ensure Shared Link Exists (Idempotent)
            const { error: sharedUpsertError } = await supabase
                .from('shared_links')
                .upsert({ id: urlHash, url: b.url }, { onConflict: 'id' });
            if (sharedUpsertError) {
                console.error(`[INGEST WORKER] Failed to upsert shared link ${b.url}:`, sharedUpsertError);
                if (handled % 25 === 0 || handled === rawBookmarks.length) {
                    await job.updateProgress({ processed: handled, total: rawBookmarks.length });
                }
                continue;
            }

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
                if (error) {
                    console.error(`[INGEST WORKER] Failed to insert bookmark ${b.url}:`, error);
                }
                // Bookmark already exists or error, skip
                if (handled % 25 === 0 || handled === rawBookmarks.length) {
                    await job.updateProgress({ processed: handled, total: rawBookmarks.length });
                }
                continue;
            }

            // 3. Check if Shared Link already has a vector (Cache Hit)
            const { data: shared, error: sharedLookupError } = await supabase
                .from('shared_links')
                .select('vector')
                .eq('id', urlHash)
                .single();
            if (sharedLookupError) {
                console.error(`[INGEST WORKER] Failed to lookup shared vector for ${b.url}:`, sharedLookupError);
                await supabase
                    .from('bookmarks')
                    .update({ status: 'error' })
                    .eq('id', inserted.id);
                if (handled % 25 === 0 || handled === rawBookmarks.length) {
                    await job.updateProgress({ processed: handled, total: rawBookmarks.length });
                }
                continue;
            }

            if (shared?.vector) {
                console.log(`[INGEST WORKER] Cache HIT for ${b.url}`);
                // Mark as embedded immediately
                const { error: embeddedUpdateError } = await supabase
                    .from('bookmarks')
                    .update({ status: 'embedded' })
                    .eq('id', inserted.id);
                if (embeddedUpdateError) {
                    console.error(`[INGEST WORKER] Failed to mark bookmark as embedded ${inserted.id}:`, embeddedUpdateError);
                    await supabase
                        .from('bookmarks')
                        .update({ status: 'error' })
                        .eq('id', inserted.id);
                }
            } else {
                // Cache MISS - Add to Enrichment Queue
                await queues.enrichment.add(
                    'enrich',
                    {
                        userId,
                        bookmarkId: inserted.id,
                        url: inserted.url,
                    },
                    { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
                );
            }

            saved++;

            if (handled % 25 === 0 || handled === rawBookmarks.length) {
                await job.updateProgress({ processed: handled, total: rawBookmarks.length });
            }

            if (handled % 100 === 0) {
                console.log(`[INGEST WORKER] Processed ${handled}/${rawBookmarks.length}`);
            }
        }
        await job.updateProgress({ processed: rawBookmarks.length, total: rawBookmarks.length });
        console.log(`[INGEST WORKER] Done: ${saved} bookmarks saved (${handled} handled)`);

        if (isUserCancelled(userId)) {
            console.log(`[INGEST WORKER] Cancelled before scheduling clustering for user ${userId}`);
            return;
        }

        // Schedule clustering to run after embeddings complete
        // Add with delay to allow embedding jobs to finish first
        console.log(`[INGEST WORKER] Scheduling clustering job for user ${userId}`);
        await queues.clustering.add('cluster', { userId, clusteringSettings }, {
            delay: 2000, 
            jobId: `cluster-${userId}-${Date.now()}` // Unique ID to ensure it runs
        });
    } catch (error) {
        console.error(`[INGEST WORKER] ERROR:`, error);
        throw error;
    }
};
