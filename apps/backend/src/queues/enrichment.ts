import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { supabase } from '../db';
import { isUserCancelled } from '../lib/cancellation';

import * as cheerio from 'cheerio';

interface EnrichmentJobData {
    userId: string;
    bookmarkId: string;
    url: string;
}

export const enrichmentProcessor = async (job: Job<EnrichmentJobData>) => {
    const { userId, bookmarkId, url } = job.data;
    console.log(`Enriching bookmark ${bookmarkId}: ${url}`);

    if (isUserCancelled(userId)) {
        console.log(`[ENRICHMENT] Cancelled before start for user ${userId}`);
        return;
    }

    let description = '';
    let title = '';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
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

    if (isUserCancelled(userId)) {
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

    if (isUserCancelled(userId)) {
        console.log(`[ENRICHMENT] Cancelled before embedding enqueue for user ${userId}`);
        return;
    }

    // Add to Embedding Queue
    await queues.embedding.add(
        'embed',
        {
            userId,
            bookmarkId,
            text: `${title} ${description} ${url}`,
            url,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
    );
};
