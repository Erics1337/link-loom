import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fakeSupabase } from './fakeSupabase';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const useFakeSupabase = process.env.BACKEND_E2E_FAKE_SUPABASE === 'true';

// Use service role key for backend operations (bypasses RLS)
if (useFakeSupabase) {
    console.log('Supabase client initialized with e2e fake adapter');
} else if (!supabaseServiceRoleKey) {
    console.error('WARNING: SUPABASE_SERVICE_ROLE_KEY is missing! RLS may block queries.');
} else {
    console.log('Supabase client initialized with service role key');
}

export const supabase = useFakeSupabase
    ? fakeSupabase as unknown as ReturnType<typeof createClient>
    : createClient(supabaseUrl, supabaseServiceRoleKey);
