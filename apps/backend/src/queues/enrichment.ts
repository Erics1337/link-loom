import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { db } from '../db';
import { bookmarks } from '../db/schema';
import { eq } from 'drizzle-orm';
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
    } catch (err) {
        console.error(`Failed to scrape ${url}`, err);
    }

    // Update DB
    await db.update(bookmarks)
        .set({
            description,
            status: 'enriched',
        })
        .where(eq(bookmarks.id, bookmarkId));

    // Add to Embedding Queue
    await queues.embedding.add('embed', {
        bookmarkId,
        text: `${title} ${description} ${url}`,
    });
};
