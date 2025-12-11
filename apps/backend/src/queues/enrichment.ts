import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { supabase } from '../db';

import * as cheerio from 'cheerio';

interface EnrichmentJobData {
    bookmarkId: string;
    url: string;
}

export const enrichmentProcessor = async (job: Job<EnrichmentJobData>) => {
    const { bookmarkId, url } = job.data;
    console.log(`Enriching bookmark ${bookmarkId}: ${url}`);

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

    // Update DB
    await supabase
        .from('bookmarks')
        .update({ description, status: 'enriched' })
        .eq('id', bookmarkId);

    // Add to Embedding Queue
    await queues.embedding.add('embed', {
        bookmarkId,
        text: `${title} ${description} ${url}`,
        url,
    });
};
