import { renamingQueue } from '../src/queue/queues';
import { query } from '../src/db/client';

async function requeueRenaming() {
    try {
        console.log('Finding bookmarks with identical original and current titles...');

        // Find bookmarks where title == original_title (meaning AI didn't change it)
        // AND content is present (so we can actually rename it)
        const res = await query(`
            SELECT id, content FROM bookmarks 
            WHERE original_title IS NOT NULL 
            AND title = original_title
            AND content IS NOT NULL
            AND length(trim(content)) > 0
        `);

        console.log(`Found ${res.rows.length} bookmarks to re-process.`);

        if (res.rows.length === 0) {
            console.log('No bookmarks to requeue.');
            return;
        }

        let count = 0;
        for (const row of res.rows) {
            await renamingQueue.add('rename', {
                bookmarkId: row.id,
                content: row.content
            }, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000
                }
            });
            count++;
            if (count % 100 === 0) process.stdout.write('.');
        }

        console.log(`\nSuccessfully queued ${count} bookmarks for renaming.`);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

requeueRenaming();
