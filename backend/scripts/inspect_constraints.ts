
import { query } from '../src/db/client';
import dotenv from 'dotenv';

dotenv.config();

async function inspect() {
    try {
        const res = await query(`
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'public' AND conrelid = 'bookmarks'::regclass;
        `);
        console.log('Constraints on bookmarks table:');
        res.rows.forEach(r => console.log(`- ${r.conname}: ${r.pg_get_constraintdef}`));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

inspect();
