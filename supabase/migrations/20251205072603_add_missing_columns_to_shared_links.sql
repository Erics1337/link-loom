-- Add missing columns to shared_links table
ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS vector vector(1536);
ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Add missing columns to users table (in case they're missing)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
