import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error(
    "SUPABASE_URL is missing. Set it before starting the backend.",
  );
  process.exit(1);
}

if (!supabaseServiceRoleKey) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is missing. Set it before starting the backend.",
  );
  process.exit(1);
}

console.log("Supabase client initialized with service role key");

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
);
