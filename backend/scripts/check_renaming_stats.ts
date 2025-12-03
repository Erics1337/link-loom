import { query } from '../src/db/client';

async function checkStats() {
    try {
        const res = await query(`
            SELECT 
                COUNT(*) as total, 
                COUNT(original_title) as renamed, 
                COUNT(content) as has_content,
                COUNT(CASE WHEN content IS NULL OR length(trim(content)) = 0 THEN 1 END) as empty_content
            FROM bookmarks
        `);
        console.log('Stats:', res.rows[0]);

        const sameTitle = await query(`
            SELECT COUNT(*) as count FROM bookmarks 
            WHERE original_title IS NOT NULL 
            AND title = original_title
        `);
        console.log('Renamed but same title:', sameTitle.rows[0].count);

        const sampleSame = await query(`
            SELECT title, url FROM bookmarks 
            WHERE original_title IS NOT NULL 
            AND title = original_title
            LIMIT 10
        `);
        console.log('Sample same title:', sampleSame.rows);



    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

checkStats();
