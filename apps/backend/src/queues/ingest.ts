import { Job } from 'bullmq';
import { queues } from '../lib/queue';
import { db } from '../db';
import { bookmarks } from '../db/schema';

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
    console.log(`Ingesting ${rawBookmarks.length} bookmarks for user ${userId}`);

    for (const b of rawBookmarks) {
        // Insert into DB
        const [inserted] = await db.insert(bookmarks).values({
            userId,
            chromeId: b.id,
            url: b.url,
            title: b.title,
            status: 'pending',
        }).returning();

        // Add to Enrichment Queue
        await queues.enrichment.add('enrich', {
            bookmarkId: inserted.id,
            url: inserted.url,
        });
    }
};
