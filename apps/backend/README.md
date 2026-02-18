# Link Loom Backend

For the full, current architecture and status snapshot, see [`ARCHITECTURE.md`](./ARCHITECTURE.md) (as of February 17, 2026).

## Architecture

### Shared Embedding Cache

To optimize costs and performance, Link Loom uses a **Shared Embedding Cache**.

- **Mechanism**: When a URL is processed, we generate a SHA-256 hash of the URL. We check the `shared_links` table for an existing embedding with this hash.
- **Privacy**: We only store the *public* URL and its embedding. User-specific data (titles, descriptions, notes) remains private and partitioned by `userId`.
- **Benefit**: If User A adds "google.com", we pay for the embedding once. If User B adds "google.com" later, we reuse the existing embedding instantly, saving API costs and processing time.

## Dev Configuration

- `FREE_TIER_LIMIT`: Optional override for the free bookmark cap (default `500`).
  - Example for local testing large libraries: `FREE_TIER_LIMIT=10000`
- `CLUSTER_NAME_CONCURRENCY`: Parallel cluster-name workers (default `4`).
- `CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI`: Minimum bookmarks in a group before calling OpenAI for a generated name (default `12`).
