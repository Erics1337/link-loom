import { query } from '../db/client';
import { enrichmentQueue } from '../queue/queues';

export interface BookmarkInput {
    id: string;
    url: string;
    title: string;
    parentId?: string;
    index?: number;
    dateAdded?: number;
}

export class BookmarkService {
    async syncBookmarks(userId: string, bookmarks: BookmarkInput[]) {
        // 1. Ensure user exists
        await query(
            `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
            [userId]
        );

        // 2. Upsert bookmarks
        let newCount = 0;
        let updatedCount = 0;

        for (const bm of bookmarks) {
            // Use composite ID to prevent collisions between users
            // Format: userId_chromeId
            const dbId = `${userId}_${bm.id}`;

            const res = await query(
                `INSERT INTO bookmarks (id, user_id, url, title, status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         ON CONFLICT (id) 
         DO UPDATE SET 
           url = EXCLUDED.url,
           title = EXCLUDED.title,
           updated_at = CURRENT_TIMESTAMP
         RETURNING xmax`,
                [dbId, userId, bm.url, bm.title]
            );

            if (res.rows[0]?.xmax === '0') {
                newCount++;
                // Trigger enrichment for new bookmarks
                await enrichmentQueue.add('enrich', {
                    bookmarkId: dbId,
                    url: bm.url,
                    title: bm.title
                });
            } else {
                updatedCount++;
                // Check if it was in ERROR state, if so, retry
                const currentStatusRes = await query(`SELECT status FROM bookmarks WHERE id = $1`, [dbId]);
                if (currentStatusRes.rows[0]?.status === 'ERROR') {
                    console.log(`Retrying failed bookmark: ${dbId}`);
                    await query(`UPDATE bookmarks SET status = 'PENDING' WHERE id = $1`, [dbId]);
                    await enrichmentQueue.add('enrich', {
                        bookmarkId: dbId,
                        url: bm.url,
                        title: bm.title
                    });
                }
            }
        }

        // 3. Calculate Duplicates (based on input array)
        const uniqueUrls = new Set(bookmarks.map(b => b.url));
        const duplicateCount = bookmarks.length - uniqueUrls.size;

        // Store metadata in Redis
        const { redis } = await import('../lib/redis');
        await redis.set(`metadata:${userId}`, JSON.stringify({ duplicateCount }));

        return { newCount, updatedCount, total: bookmarks.length, duplicateCount };
    }
}
