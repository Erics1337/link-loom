
import { supabase } from '../db';
import * as dotenv from 'dotenv';

dotenv.config();

const debugHandler = async () => {
    console.log('--- DEBUGGING PENDING BOOKMARKS ---');

    const { data, error } = await supabase
        .from('bookmarks')
        .select('*')
        .eq('status', 'pending');

    if (error) {
        console.error('❌ Failed to fetch pending bookmarks:', error);
    } else {
        console.log(`Found ${data?.length || 0} pending bookmarks:`);
        data?.forEach(b => {
            console.log(`- ID: ${b.id}`);
            console.log(`  URL: ${b.url}`);
            console.log(`  Title: ${b.title}`);
            console.log(`  Created At: ${b.created_at}`);
            console.log('---');
        });
    }

    process.exit(0);
};

debugHandler();
