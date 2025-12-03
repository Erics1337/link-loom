CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY, -- Installation ID
  premium_status BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id VARCHAR(255) PRIMARY KEY, -- Chrome Bookmark ID (or UUID)
  user_id VARCHAR(255) REFERENCES users(id),
  url TEXT NOT NULL,
  title TEXT,
  original_title TEXT, -- Original browser title (before AI renaming)
  description TEXT,
  content TEXT, -- Scraped content
  status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, ENRICHED, EMBEDDED, ERROR
  cluster_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clusters (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) REFERENCES users(id),
  name TEXT NOT NULL,
  parent_id VARCHAR(255) REFERENCES clusters(id),
  centroid vector(1536), -- OpenAI Embedding Dimension
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS embeddings (
  bookmark_id VARCHAR(255) REFERENCES bookmarks(id) ON DELETE CASCADE,
  vector vector(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bookmark_id)
);
