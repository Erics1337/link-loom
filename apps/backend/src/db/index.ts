import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Use service role key for backend operations (bypasses RLS)
if (!supabaseServiceRoleKey) {
    console.error('WARNING: SUPABASE_SERVICE_ROLE_KEY is missing! RLS may block queries.');
} else {
    console.log('Supabase client initialized with service role key');
}
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
