-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  is_premium BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  subscription_id TEXT,
  subscription_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared links cache (URL -> embedding cache, shared across all users)
CREATE TABLE IF NOT EXISTS shared_links (
  id TEXT PRIMARY KEY, -- SHA-256 hash of URL
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  vector vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookmarks (per-user bookmarks)
CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  chrome_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  ai_title TEXT,
  description TEXT,
  content_hash TEXT, -- References shared_links.id for embedding lookup
  status TEXT DEFAULT 'pending', -- pending, enriched, embedded, error
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clusters (generated folder structure)
CREATE TABLE IF NOT EXISTS clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  parent_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cluster assignments (which bookmarks belong to which cluster)
CREATE TABLE IF NOT EXISTS cluster_assignments (
  cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
  bookmark_id UUID REFERENCES bookmarks(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, bookmark_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_content_hash ON bookmarks(content_hash);
CREATE INDEX IF NOT EXISTS idx_clusters_user_id ON clusters(user_id);
CREATE INDEX IF NOT EXISTS idx_clusters_parent_id ON clusters(parent_id);

-- Vector similarity search index  
CREATE INDEX IF NOT EXISTS idx_shared_links_vector ON shared_links USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
