import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const isTestEnv =
  process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  if (isTestEnv) {
    console.warn(
      "[db] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing; using test placeholders.",
    );
  } else {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before starting the backend.",
    );
  }
}

if (!isTestEnv) {
  console.log("Supabase client initialized with service role key");
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? "http://127.0.0.1:54321",
  supabaseServiceRoleKey ?? "test-service-role-key",
);
