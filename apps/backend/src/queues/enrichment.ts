import { QueueJob, queues } from '../lib/queue';
import { supabase } from '../db';
import { isUserCancelled } from '../lib/cancellation';
import { safeFetch } from '../lib/safeFetch';

import * as cheerio from 'cheerio';

export interface EnrichmentJobData {
    userId: string;
    jobGeneration?: number;
    bookmarkId: string;
    url: string;
}

export const enrichmentProcessor = async (job: QueueJob<EnrichmentJobData>) => {
    const { userId, jobGeneration, bookmarkId, url } = job.data;
    console.log(`Enriching bookmark ${bookmarkId}: ${url}`);

    if (await isUserCancelled(userId, jobGeneration)) {
        console.log(`[ENRICHMENT] Cancelled before start for user ${userId}`);
        return;
    }

    let description = '';
    let title = '';

    try {
        const response = await safeFetch(url, { timeoutMs: 5000 });
        const html = await response.text();
        const $ = cheerio.load(html);
        title = $('title').text().trim() || '';
        description = $('meta[name="description"]').attr('content') || '';
    } catch (err: any) {
        if (err.name === 'AbortError') {
             console.warn(`[SCRAPE TIMEOUT] ${url}`);
        } else {
             console.warn(`[SCRAPE FAILED] ${url}: ${err.message}`);
        }
    }

    if (await isUserCancelled(userId, jobGeneration)) {
        console.log(`[ENRICHMENT] Cancelled after fetch for user ${userId}`);
        return;
    }

    // Update DB
    const { error: enrichmentUpdateError } = await supabase
        .from('bookmarks')
        .update({ description, status: 'enriched' })
        .eq('id', bookmarkId);
    if (enrichmentUpdateError) {
        console.error(`[ENRICHMENT] Failed to update bookmark ${bookmarkId}:`, enrichmentUpdateError);
        await supabase
            .from('bookmarks')
            .update({ status: 'error' })
            .eq('id', bookmarkId);
        return;
    }

    if (await isUserCancelled(userId, jobGeneration)) {
        console.log(`[ENRICHMENT] Cancelled before embedding enqueue for user ${userId}`);
        return;
    }

    // Add to Embedding Queue
    await queues.embedding.add(
        'embed',
        {
            userId,
            jobGeneration,
            bookmarkId,
            text: `${title} ${description} ${url}`,
            url,
        },
        {
            jobId: `embed-${userId}-generation-${jobGeneration ?? 'legacy'}-${bookmarkId}`,
        }
    );
};
