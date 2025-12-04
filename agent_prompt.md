# Project Rebuild: Link-Loom Agent Prompt

## 1. Project Overview
**Link-Loom** is an AI-powered Chrome extension that organizes messy browser bookmarks into a clean, semantic hierarchy. The current iteration has suffered from complexity creep, fragile state synchronization between the extension and backend, and scalability issues.

**Goal**: Rebuild the system from scratch with a focus on **robustness**, **simplicity**, and **scalability**. The core value proposition is "One-click AI organization of bookmarks."

## 2. Core Technologies
The new system should utilize the following stack (unless you have strong reasons to deviate):

*   **Frontend (Extension)**: Chrome Extension Manifest V3 (Vanilla JS/HTML/CSS or React/Vite).
*   **Backend**: Node.js (Fastify or Express) with TypeScript.
*   **Database**: PostgreSQL with `pgvector` for embeddings.
*   **Queue/Async**: BullMQ with Redis for background processing (critical for long-running AI tasks).
*   **AI**: OpenAI API (Embeddings `text-embedding-3-small` + Chat Completion `gpt-4o-mini` for renaming).
*   **Infrastructure**: Docker & Kubernetes (for deployment).

## 3. Product Requirements

### A. User Flow
1.  **Onboarding**: User installs extension, signs up/logs in (Supabase Auth or custom).
2.  **Sync**: Extension syncs local bookmarks to the backend.
3.  **Organize**: User clicks "Weave" (Organize).
    *   Backend processes bookmarks: Scrape content -> Generate Embeddings -> Cluster -> Generate Folder Names.
4.  **Review & Apply**:
    *   User sees a preview of the new structure.
    *   User clicks "Apply". Extension moves bookmarks into new folders and renames them.
5.  **Maintenance**:
    *   **Smart Rename**: AI suggests better titles for bookmarks.
    *   **Dead Link Removal**: Check for 404s.
    *   **Deduplication**: Remove duplicate URLs.

### B. Key Constraints
*   **Premium Limits**: Free users are limited to organizing 500 bookmarks. Premium users are unlimited.
*   **Privacy**: User data (bookmarks) must be isolated.
*   **Performance**: Clustering 1000+ bookmarks can be slow. The UI must handle long-running states gracefully (progress bars, polling, or WebSockets).

## 4. Architecture & "What Went Wrong" (Lessons Learned)

### The Failures of v1
1.  **Fragile State Sync**: The extension relied on complex polling and massive JSON payloads to sync state.
    *   *Fix*: Use a more granular sync protocol or WebSockets. Ensure the backend is the "Source of Truth" but the extension handles the actual Chrome API calls robustly.
2.  **Monolithic Worker**: The `clusteringWorker` was doing everything: fetching data, K-Means, recursive splitting, and LLM naming in one giant loop.
    *   *Fix*: Decompose the pipeline.
        *   `IngestQueue`: Receive bookmarks.
        *   `EnrichmentQueue`: Scrape metadata (title, description).
        *   `EmbeddingQueue`: Generate vectors.
        *   `ClusteringQueue`: Run K-Means (only when requested).
3.  **Memory Limits**: Loading all user vectors into memory for clustering crashed with large libraries.
    *   *Fix*: Use database-side clustering (e.g., `pgvector` IVFFlat indexing or hierarchical clustering queries) if possible, or stream data.
4.  **Zombie Jobs**: "Stop Weave" didn't reliably kill backend jobs.
    *   *Fix*: Better job cancellation handling in BullMQ.

## 5. Suggested Data Model (Schema)

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  is_premium BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookmarks (Source of Truth)
CREATE TABLE bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  chrome_id TEXT NOT NULL, -- ID in the user's browser
  url TEXT NOT NULL,
  title TEXT, -- Original title
  ai_title TEXT, -- Proposed title
  description TEXT,
  content_hash TEXT, -- For change detection
  status TEXT DEFAULT 'pending', -- pending, enriched, embedded, error
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings (Separate for performance)
CREATE TABLE bookmark_embeddings (
  bookmark_id UUID REFERENCES bookmarks(id) ON DELETE CASCADE,
  vector vector(1536),
  PRIMARY KEY (bookmark_id)
);

-- Clusters (Generated Structure)
CREATE TABLE clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT,
  parent_id UUID REFERENCES clusters(id),
  -- Store the structure definition here
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cluster Assignments
CREATE TABLE cluster_assignments (
  cluster_id UUID REFERENCES clusters(id),
  bookmark_id UUID REFERENCES bookmarks(id),
  PRIMARY KEY (cluster_id, bookmark_id)
);
```

## 6. Implementation Strategy for the Agent

1.  **Phase 1: Foundation**: Setup Node.js backend, Postgres, and basic Extension skeleton. Establish secure Auth.
2.  **Phase 2: Pipeline**: Build the `Enrichment -> Embedding` pipeline. Ensure it's robust and resumable.
3.  **Phase 3: The Brain (Clustering)**: Implement the clustering logic.
    *   *Pattern*: Fetch vectors -> K-Means (Hierarchical) -> LLM Naming.
    *   *Output*: A JSON tree structure representing the proposed folder hierarchy.
4.  **Phase 4: The Hands (Extension Action)**: Implement the "Apply" logic in the extension.
    *   *Critical*: This must be non-destructive (or offer Undo). It should move bookmarks into the new folders.

## 7. Special Instructions
*   **Do not overengineer the frontend**. Keep it clean and functional. The magic is in the backend.
*   **Use `pgvector` effectively**. Don't reinvent vector math in Node.js if Postgres can do it.
*   **Error Handling**: If OpenAI fails, retry. If a URL is dead, mark it but don't crash the weave.
