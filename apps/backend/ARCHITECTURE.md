# Link Loom Architecture (Current State)

As of **February 17, 2026**

## 1. Purpose

This document is the implementation-level architecture reference for Link Loom's bookmark organization system.
It consolidates behavior from:

- Root docs: `README.md`, `agent_prompt.md`
- Backend docs/code: `apps/backend/README.md`, `apps/backend/src/**`
- Extension code: `apps/extension/src/**`
- Web app code: `apps/web/app/**`
- Supabase schema/migrations: `supabase/migrations/**`

If this document conflicts with older docs, **current code and migrations are the source of truth**.

---

## 2. Executive Summary

Link Loom is a queue-driven bookmark pipeline with a Chrome extension UI:

1. Extension sends bookmark list to backend `/ingest`.
2. Backend runs workers: `ingest -> enrichment -> embedding -> clustering`.
3. Extension polls `/status/:userId` every 2 seconds.
4. Extension fetches final folder tree from `/structure/:userId`.
5. Extension applies folder/bookmark moves with Chrome Bookmarks API.

Key properties of current implementation:

- Shared embedding cache across users (`shared_links` table).
- Free-tier cap enforced server-side (`FREE_TIER_LIMIT`, default 500).
- Device cap enforced (`user_devices`, max 3 per user in app logic + RLS policy).
- Cluster naming uses mixed strategy:
  - heuristic naming for smaller groups
  - OpenAI naming for larger groups
- Backup snapshots are **extension-local** (Chrome storage), not stored in backend DB.

---

## 3. High-Level System Map

```text
Chrome Extension (React popup)
  |
  | POST /ingest, GET /status, GET /structure, POST /cancel, POST /trigger-clustering
  v
Backend (Fastify + BullMQ + Redis)
  |
  +--> Ingest Worker
  +--> Enrichment Worker (scrape title/description)
  +--> Embedding Worker (OpenAI embeddings + cache)
  +--> Clustering Worker (recursive k-means + folder naming)
  |
  v
Supabase Postgres (+ pgvector)

Web App (Next.js)
  |
  +--> Supabase Auth UI + dashboard
  +--> Stripe checkout + webhook updates to users.is_premium
```

---

## 4. Data Model (Current)

Primary tables from migrations:

- `users`
  - identity + billing flags (`is_premium`, Stripe fields)
- `shared_links`
  - global URL hash cache with `vector(1536)`
- `bookmarks`
  - per-user bookmark records (`chrome_id`, `url`, `title`, `description`, `content_hash`, `status`)
  - unique: `(user_id, chrome_id)`
- `clusters`
  - generated folder hierarchy (`parent_id` self-reference)
- `cluster_assignments`
  - mapping bookmark -> cluster (PK `(cluster_id, bookmark_id)`)
- `user_devices`
  - per-user registered devices, constrained to 3 via policy/app checks

Important note on backups:

- There is currently **no** backend table for bookmark backups.
- Backups are stored in extension `chrome.storage.local`, keyed by `bookmarkBackups:<accountUserId>`.

---

## 5. Algorithm Pipeline

## Stage 1: Ingest

Input: bookmark tree flattened by extension (`id`, `url`, `title`).

Worker behavior:

1. Ensure `users` row exists.
2. For each bookmark:
   - SHA-256 hash URL -> `content_hash`
   - upsert `shared_links(id=url_hash, url)`
   - upsert `bookmarks` with `status='pending'`
3. If `shared_links.vector` exists:
   - mark bookmark `status='embedded'` (cache hit fast-path)
4. Else enqueue enrichment job.
5. After ingest loop: enqueue clustering job with short delay.

Outcome:

- Fast imports when many links are cache hits.

## Stage 2: Enrichment + Embedding

Enrichment worker:

- fetches URL (5s timeout), parses `<title>` and meta description with Cheerio.
- updates bookmark `description`, `status='enriched'`.
- enqueues embedding job with combined text (`title + description + url`).

Embedding worker:

1. Re-check shared cache by URL hash.
2. Cache miss: call OpenAI `text-embedding-3-small`.
3. Save vector into `shared_links.vector`.
4. Set bookmark `status='embedded'`.
5. On failure: set bookmark `status='error'`.

## Stage 3: Clustering

Clustering worker:

1. Pull user bookmarks in pages of 1000.
2. Join `shared_links.vector` via `content_hash`.
3. Filter to valid vectors.
4. Run recursive k-means partitioning:
   - base case: `<= 5` items -> assign directly to parent cluster.
   - recursive case:
     - run k-means (`k=min(5, n)`)
     - create child cluster rows
     - recurse each child group

Folder naming strategy:

- For small groups (`CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI`, default 12): heuristic naming (domain/token frequency).
- For larger groups: OpenAI chat completion (`gpt-4o-mini`) with retry/backoff for 429s.
- Naming calls are concurrency-limited (`CLUSTER_NAME_CONCURRENCY`, default 4).

---

## 6. Progress + State Model

Backend `/status/:userId` returns:

- counts by bookmark status (`pendingRaw`, `enriched`, `embedded`, `errored`)
- clustering metrics (`clusters`, `assigned`, `remainingToAssign`, `isClusteringActive`)
- ingest queue progress (`isIngesting`, `ingestProcessed`, `ingestTotal`)
- billing flag (`isPremium`)
- completion flag (`isDone`)

Extension maps this to 3 UX stages:

1. Stage 1/3: Indexing bookmarks (ingest progress)
2. Stage 2/3: Enriching + embeddings
3. Stage 3/3: Structuring into folders (cluster/assignment progress)

Polling frequency: every 2 seconds while weaving.

---

## 7. Apply Flow (Chrome Write Phase)

When user clicks "Apply Changes":

1. Confirm dialog in extension.
2. If logged in: auto-save current bookmark backup snapshot locally.
3. Fetch `/structure/:userId` from backend.
4. Create root folder in "Other Bookmarks":
   - `Link Loom - <date>`
5. Create cluster folder hierarchy (parent-first topological order).
6. Move Chrome bookmarks into assigned folders.

This write phase happens fully in extension using Chrome APIs.

---

## 8. Auth, Device, Billing, and Backups

## Auth

- Extension auth uses Supabase Auth REST endpoints directly.
- Session stored in extension local storage key: `extensionAuthSession`.
- Logged-in user id is reused as backend `userId`.

## Device Limits

- Extension registers device via backend `/register-device`.
- Backend checks existing devices and blocks if >= 3 (`403`).
- Web dashboard page allows viewing/removing devices.

## Billing / Premium

- Free tier limit enforced in backend `/ingest` using `users.is_premium`.
- Limit default is 500 (`FREE_TIER_LIMIT`, override supported).
- Stripe checkout endpoints exist in web app:
  - `/api/create-checkout-session` (used by extension signup flow and billing page)
  - `/api/checkout` (also exists; separate path)
- Stripe webhook updates `users.is_premium` and subscription fields.

## Backups and Versions

- Bookmark backups:
  - saved in extension local storage
  - require login in extension UI
  - can be manually saved, restored, deleted
  - auto-saved before apply when logged in
- Structure versions:
  - also local extension storage
  - save/load/restore/delete functions exist
  - currently not exposed in main extension navigation flow

---

## 9. Consolidation vs Older Docs

The following items in older docs are now outdated or only partially true:

- `agent_prompt.md` describes aspirational architecture and older pain points.
- It references a separate `bookmark_embeddings` table; current implementation uses `shared_links.vector`.
- It suggests database-side clustering as a fix path; current clustering is in Node worker memory via `ml-kmeans`.
- Root README is broadly correct but does not capture newer features:
  - extension login flow
  - device registration limits
  - local backup management
  - current stage/progress semantics

Also, extension/web app currently do not have dedicated README files in this repo snapshot.

---

## 10. Current Status Snapshot (2026-02-17)

### Implemented and Operational

- End-to-end pipeline (`ingest -> enrichment -> embedding -> clustering`)
- Shared embedding cache
- Recursive folder hierarchy generation
- Apply-to-Chrome folder/bookmark movement
- Poll-based progress UX with stage-specific detail
- Free-tier gate + premium flag integration
- Supabase login in extension
- Device registration and 3-device ceiling
- Local backup snapshots with restore/delete

### Implemented but With Known Constraints

- Stage 3 can be long for large libraries due recursive clustering and naming throughput.
- Clustering worker still holds many vectors in Node memory.
- Backups are local-only; no cross-device/server backup history.
- Cancellation sets bookmark status to `idle` even though status enum/commenting is inconsistent across code/docs.
- Two web checkout endpoints can cause product-flow drift if not standardized.

### Not Fully Productized Yet

- Structure versions screen exists but is not wired into main extension navigation.
- Dead-link cleanup and duplicate deletion are mostly UI placeholders.
- No websocket push; status is polling-based.

---

## 11. Operational Notes

- Queue engine: BullMQ + Redis.
- Worker concurrency defaults:
  - enrichment: 50
  - embedding: 20
  - clustering: 1 worker instance (internally parallel recursion/naming)
- Useful backend debug artifacts:
  - `apps/backend/clustering-debug.log`
  - scripts under `apps/backend/src/scripts/`

---

## 12. Recommended Source-of-Truth Hierarchy

For future updates, use this order:

1. Code in `apps/backend/src`, `apps/extension/src`, `apps/web/app`
2. DB migrations in `supabase/migrations`
3. This `apps/backend/ARCHITECTURE.md`
4. Other docs (`README.md`, `agent_prompt.md`) after verification

