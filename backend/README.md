# link-loom Backend Service

This is the backend service for the link-loom Chrome Extension. It handles data synchronization, bookmark enrichment, AI analysis, and clustering.

## 🚀 How to Run

You need to run **both** the API server and the Background Worker for the system to function.

We have a unified command to run everything at once:

```bash
npm run dev:all
```

This will start:
1.  **API Server** (`localhost:3000`): Handles requests from the Chrome Extension.
2.  **Worker Process**: Processes background jobs (scraping, AI, clustering).

### Alternative (Manual)
If you prefer to run them separately:
- **Terminal 1**: `npm run dev` (API)
- **Terminal 2**: `npm run worker` (Background Jobs)

---

## 🏗️ Architecture

The system consists of two main parts:

1.  **The Waiter (API Server)**:
    *   Accepts requests (e.g., "Organize Bookmarks").
    *   Queues jobs in Redis.
    *   Returns immediate status updates to the UI.

2.  **The Kitchen (Background Worker)**:
    *   Picks up jobs from the queue.
    *   Performs long-running, heavy tasks asynchronously.

### ⚡ Why BullMQ? (Event-Driven Architecture)
We use an event-driven queue system (BullMQ on Redis) for several critical reasons:

1.  **Reliability & Persistence**: If the server crashes or restarts, jobs aren't lost. They remain in the queue and resume processing exactly where they left off.
2.  **Decoupling**: The API returns immediately ("Job Accepted"), preventing browser timeouts during long tasks like scraping 500+ sites.
3.  **Rate Limiting & Concurrency**: We can precisely control how many sites we scrape at once (to avoid bans) and how many AI requests we send (to avoid rate limits), regardless of how many users are active.
4.  **Retries**: Transient network errors are automatically retried without user intervention.

## ⚙️ Worker Pipeline

The `npm run worker` command runs a pipeline of 3 specialized workers that process bookmarks in steps:

### 1. Enrichment Worker (`enrichmentWorker.ts`)
*   **Goal**: Get high-quality metadata for every link to ensure accurate clustering.
*   **Strategy**:
    1.  **Check Existing Metadata**: If the bookmark already has a long title (>10 chars) and description (>30 chars), we use it as is.
    2.  **Lightweight Head Scrape**:
        *   We fetch the page HTML and parse the `<head>` tag.
        *   Extracts: `og:title`, `og:description`, `keywords`, `h1`, and `JSON-LD` (structured data).
        *   If this provides sufficient data, we use it and skip the full scrape.
    4.  **Firecrawl Fallback**:
        *   If the head scrape is insufficient, we use **Firecrawl** to fully scrape the page content.
        *   This ensures even complex SPAs or minimal pages get analyzed.
        *   **Smart Fallback**: If we hit a quota limit or error with Firecrawl, we gracefully fall back to using whatever basic metadata (Title/URL) we have, ensuring the pipeline never stalls.
    5.  **Broken Link Detection**: Marks 404s/dead links as `BROKEN`.

### 2. Embedding Worker (`embeddingWorker.ts`)
*   **Goal**: Translate text into meaning (vectors).
*   **Process**:
    *   Takes the title, description, and scraped content.
    *   Sends it to **OpenAI** to generate an "embedding" (a list of numbers representing the semantic meaning).
    *   Stores the vector in Postgres (`pgvector`).

### 3. Clustering Worker (`clusteringWorker.ts`)
*   **Goal**: Organize bookmarks into meaningful, balanced groups.
*   **Algorithm**: Recursive K-Means with Capacity Constraints.
*   **Parameters**:
    *   **Target Size (T)**: ~15 bookmarks per folder (aiming for high specificity).
    *   **Max Size (MAX)**: 30 bookmarks (hard limit to force sub-folders).
    *   **Min Size (MIN)**: 5 bookmarks (allows small, niche topics).
*   **Process**:
    1.  **Normalization**: All embedding vectors are normalized to unit length to allow cosine similarity.
    2.  **Top-Level Clustering**:
        *   Calculates initial clusters based on total bookmarks ($N$).
        *   **Formula**: $K_{top} = \max(5, \min(50, \text{round}(N / 15)))$.
        *   This ensures a minimum of 5 folders and a hard cap of 50 top-level folders to keep the UI clean.
        *   Runs K-Means to create broad categories.
    3.  **Recursive Splitting (Sub-folders)**:
        *   **Trigger**: If any cluster has **> 30 bookmarks** (`MAX`), it is considered "too big" and triggers a split.
        *   **Sub-clustering**: The system runs K-Means again on just that cluster's bookmarks, aiming for sub-groups of ~15 items.
        *   **Depth Limit**: This process repeats recursively but stops automatically at **5 levels deep** to prevent infinite loops, even if a folder remains large.
    4.  **Merging**:
        *   Identifies "lonely" clusters (size < MIN).
        *   Merges them into the nearest neighbor cluster (by cosine distance) if the combined size fits.
    5.  **Naming**:
        *   Selects representative bookmarks from each cluster.
        *   Uses **OpenAI** to generate a concise, descriptive name (e.g., "Web Development", "Italian Recipes").
    6.  **Assignment**: Saves the folder structure and assigns bookmarks to clusters.
