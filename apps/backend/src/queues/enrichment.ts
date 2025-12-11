import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { supabase } from '../db';
import axios from 'axios';
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
        const response = await axios.get(url, { timeout: 5000 });
        const $ = cheerio.load(response.data);
        title = $('title').text().trim() || '';
        description = $('meta[name="description"]').attr('content') || '';
    } catch (err: any) {
        if (err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
            console.warn(`[SCRAPE FAILED] ${url}: ${err.message}`);
        } else if (err.response) {
             console.warn(`[SCRAPE FAILED] ${url}: Status ${err.response.status}`);
        } else {
            console.error(`[SCRAPE FAILED] ${url}`, err.message);
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
