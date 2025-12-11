
import { createClient } from '@supabase/supabase-js';

// Credentials from `npx supabase status -o json` output
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testConnection() {
    console.log('Testing connection to:', SUPABASE_URL);
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
