import { query } from '../src/db/client';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    const userId = 'fd7ae5e1-1c7d-45be-9852-a35790779454';
    console.log(`Checking bookmark status for user ${userId}...`);

    const res = await query(
        `SELECT status, COUNT(*) as count 
         FROM bookmarks 
         WHERE user_id = $1 
         GROUP BY status`,
        [userId]
    );

    console.log('Bookmark Status Distribution:');
    res.rows.forEach(r => console.log(`- ${r.status}: ${r.count}`));

    // Also check if there are any embeddings
    const embedRes = await query(
        `SELECT COUNT(*) as count 
         FROM embeddings e
         JOIN bookmarks b ON e.bookmark_id = b.id
         WHERE b.user_id = $1`,
        [userId]
    );
    console.log(`Total Embeddings in DB: ${embedRes.rows[0].count}`);

    process.exit(0);
}

main().catch(console.error);
