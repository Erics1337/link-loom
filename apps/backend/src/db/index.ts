import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (process.env.BACKEND_E2E_FAKE_SUPABASE === "true") {
  throw new Error(
    "BACKEND_E2E_FAKE_SUPABASE has been removed. Run backend e2e against local Supabase instead.",
  );
}

// Use service role key for backend operations (bypasses RLS)
if (!supabaseServiceRoleKey) {
  console.error(
    "WARNING: SUPABASE_SERVICE_ROLE_KEY is missing! RLS may block queries.",
  );
} else {
  console.log("Supabase client initialized with service role key");
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
);
