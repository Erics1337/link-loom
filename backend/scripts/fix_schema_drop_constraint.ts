
import { query } from '../src/db/client';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
    try {
        console.log('Dropping constraint bookmarks_user_id_url_key...');
        await query(`ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_user_id_url_key;`);
        console.log('Constraint dropped.');
    } catch (e) {
        console.error('Error dropping constraint:', e);
    }
    process.exit(0);
}

run();
