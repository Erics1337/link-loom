import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this check.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testConnection() {
    console.log('Testing connection to:', supabaseUrl);
    try {
        const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
        if (error) {
            console.error('Connection failed with error:', error);
        } else {
            console.log('Connection successful! User count:', data);
        }

        // Also test the specific query that was failing
        const { error: queryError } = await supabase.from('bookmarks').select('*', { count: 'exact', head: true }).limit(1);
        if (queryError) {
             console.error('Bookmarks query failed:', queryError);
        } else {
             console.log('Bookmarks query successful');
        }

    } catch (err) {
        console.error('Connection crashed:', err);
    }
}

testConnection();
