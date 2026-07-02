# Link Loom — Product & UX Audit (July 2026)

Scope inspected: backend pipeline (`apps/backend/src/queues/*`, `lib/pipelineCoordinator.ts`, `lib/cancellation.ts`), routes (`ingest`, `status`, `structure`, `search`, `tools`), Supabase schema/migrations, extension flows (`useWeaveRun`, `useBookmarkWeaver`, `chromeApplyPlan`, `structurePreviewBuilder`, screens).

## Architecture summary (as-is)

Extension scans Chrome tree → `POST /ingest` **clears all user bookmarks + clusters**, queues ingest → per-bookmark upsert into `bookmarks` + `shared_links` (sha256 URL hash, shared embedding cache) → cache miss goes enrichment (meta description scrape) → embedding (OpenAI `text-embedding-3-small`, page text + metadata) → pipeline coordinator claims clustering when all bookmarks terminal → recursive k-means (density profile: targetLeafSize/maxChildren/minChildSize) + outlier refinement + LLM sibling merge/labels (`gpt-4o-mini`) + heuristic-fallback naming → `clusters`/`cluster_assignments` → extension polls `/status` every 2s → preview tree → journaled apply (create folders → move/rename → cleanup root children) with resume + rollback.

The apply journal, pipeline claim/generation machinery, and shared embedding cache are genuinely well built. The weak spots are correctness edge cases, sorting stability/explainability, and a preview the user can't edit.

---

## Findings (prioritized)

### P0 — Data loss & correctness

**1. Cleanup can permanently delete bookmarks that never entered the plan**
- Issue: `cleanupRootChildren` `removeTree`s any root-level folder not in the plan. Bookmarks that errored in the pipeline (no cluster assignment → absent from plan) or were added while weaving ran still live inside those old folders. `skippedCount === 0` gate doesn't catch them because they were never planned. Rollback can't restore deleted folder contents (`skippedDeletedFolderTitles` only reports).
- User impact: silent, unrecoverable bookmark loss (except via the pre-organize backup, which users may not know exists).
- Fix: before deleting a folder tree, diff its contained bookmark URLs/ids against the plan's `keepIds` (all depths, not just root children). If any un-planned bookmark exists inside, move it to the "Unorganized" folder instead of deleting, or skip and warn. Also snapshot deleted subtree contents into the journal so rollback can fully restore.
- Files: `apps/extension/src/lib/chromeApplyPlan.ts` (`getCleanupDeleteTargets`, `cleanupRootChildren`, `rollbackAppliedJournalEntry`).
- Risk: low (additive guard).

**2. Unordered pagination in clustering fetch → duplicated/missed bookmarks**
- Issue: `fetchUserBookmarkVectorRows` uses `.range(from, to)` with no `.order()`. Postgres gives no stable ordering guarantee, so pages can overlap or skip rows on collections >1000. A bookmark can be clustered twice (two assignments) or not at all.
- User impact: bookmarks appearing in two folders or missing from results; explains nonzero `duplicateCount` on clean data.
- Fix: add `.order('id', { ascending: true })` (or keyset pagination on `id`).
- Files: `apps/backend/src/queues/clustering/clusterPersistence.ts:28-37`.
- Risk: trivial.

**3. `clustering-debug.log` written with `fs.appendFileSync` to cwd**
- Issue: `clustering.ts:34-40` appends synchronously to `process.cwd()/clustering-debug.log`. On Lambda cwd is read-only (`/var/task`) → every `log()` call throws, killing the clustering job before its try/catch fallbacks. Locally it's a committed junk file (it's in the repo root now) and sync IO on the hot path.
- User impact: clustering can hard-fail in production; weaving hangs until the extension's recovery re-trigger, then fails again.
- Fix: replace with `console.log` only (CloudWatch already captures it), gate file logging behind `NODE_ENV !== 'production'` + `/tmp`, delete the committed log, add to `.gitignore`.
- Files: `apps/backend/src/queues/clustering.ts`, repo root.
- Risk: trivial.

**4. `jobGeneration` dropped when enrichment enqueues embedding**
- Issue: `enrichment.ts:119-131` passes `pipelineRunId` but omits `jobGeneration` from the embedding job payload (the jobId builder uses it, the data doesn't). For runs tracked only by generation, `getPipelineRunGeneration` returns undefined in the embedding worker → `notifyPipelineBookmarkTerminal` no-ops → pipeline never reaches clustering; the extension's `shouldTriggerClusteringRecovery` papers over it with a fresh manual run.
- User impact: stalled runs, redundant clustering runs, confusing progress.
- Fix: add `jobGeneration` to the embedding job data.
- Files: `apps/backend/src/queues/enrichment.ts`.
- Risk: trivial.

### P1 — Sorting quality, stability, explainability

**5. Non-deterministic clustering (violates "stable")**
- Issue: `ml-kmeans` with `kmeans++` random init and no seed. Same bookmarks, same settings → different tree every run. The LLM merge pass adds more variance.
- User impact: users who re-run to tweak one setting get a completely rearranged structure; erodes trust.
- Fix: pass a deterministic seed (`kmeans(vectors, k, { initialization: 'kmeans++', seed: hash(userId + sortedBookmarkIds) })` — ml-kmeans supports `seed`). Sort input ids before clustering so ordering is canonical. Keep LLM labels but make merges deterministic by sorting merge candidates.
- Files: `apps/backend/src/queues/clustering/clusterAlgorithm.ts` (`splitClusterGroups`), `clustering.ts` (sort `parsedRows` by id).
- Risk: low.

**6. No explainability or adjustability of sorting results**
- Issue: a cluster persists only `name` + `parent_id`. No stored keywords, representative bookmarks, or confidence. The preview tree (`BookmarkTree`) is read-only — no rename, no drag-to-move, no "move to another folder" before apply.
- User impact: users can't answer "why is this here?" or fix a single misplaced bookmark; their only recourse is Apply-then-manually-fix or full re-run.
- Fix (phased):
  1. Persist per-cluster `keywords` (top tokens already computed in `generateHeuristicClusterName`) and per-assignment `distance_to_centroid`; surface top-3 keywords as a folder tooltip and flag the 2–3 farthest bookmarks per folder as "low confidence".
  2. Make the preview editable: inline folder rename + move-bookmark (context menu "Move to…" is cheaper than drag/drop and fits the popup). The apply plan already consumes an arbitrary `BookmarkNode[]`, so edits flow through for free.
- Files: `clusterPersistence.ts` (columns), `clusterNaming.ts`, new migration, `apps/extension/src/components/BookmarkTree.tsx`, `ResultsScreen.tsx`.
- Risk: medium (UI surface), model change is additive.

**7. Per-user URL duplicates are clustered as distinct bookmarks**
- Issue: bookmark upsert conflicts on `(chrome_id,user_id)`, so the same URL in two Chrome folders becomes two rows, two embeddings lookups, two placements. Dedup exists only as a post-hoc "Delete all" button using `normalizeBookmarkUrl` (which strips hash/trailing slash but keeps query strings and doesn't lowercase host — `?utm_source=` variants and `HTTPS://Site.com` count as unique).
- User impact: inflated folders; "Duplicates: N" with a destructive-only remedy; near-duplicates undetected.
- Fix: strengthen `normalizeBookmarkUrl` (lowercase host, strip default ports, drop known tracking params) and use it for both the counter and `content_hash`. In the preview, group duplicates under the canonical entry with a "duplicate" badge and offer "keep first, remove rest" as part of Apply (journaled → rollback-able) instead of a separate irreversible delete.
- Files: `apps/extension/src/lib/bookmarkStructure.ts`, `apps/backend/src/queues/ingest.ts` (hash input), `structurePreviewBuilder.ts`, `useBookmarkTools.ts`.
- Risk: low-medium (hash change invalidates shared cache entries for affected URLs — acceptable; cache repopulates).

**8. Density profiles produce shallow-but-wide or oddly deep trees at scale**
- Issue: `chooseSplitK` caps k at `maxChildren` (3/4/6). 2,000 bookmarks at "medium" → 4-way splits recursing ~5 levels deep, with an LLM naming call per node. Depth is a side effect, not a setting; no max-depth guard.
- User impact: deeply nested folders users must click through; long clustering time (sequential LLM calls at concurrency 4).
- Fix: add `maxDepth` to density profile (e.g., 3); once at max depth, do a single k-means with `k = ceil(n/targetLeafSize)` (uncapped) to fan out flat. Reduces both depth and total naming calls.
- Files: `lib/clusteringSettings.ts`, `queues/clustering.ts` (thread depth through `recursiveCluster`), `clusterAlgorithm.ts`.
- Risk: medium (changes output shape; keep behind the existing density setting).

### P2 — Performance & reliability

**9. Ingest is serial with ~4–6 DB round-trips per bookmark**
- Issue: `ingestProcessor` loops one bookmark at a time: cancellation check (SELECT), shared_link upsert, bookmark upsert, shared vector lookup, then enrichment enqueue — all awaited serially. 1,000 bookmarks ≈ 5,000 sequential queries.
- User impact: the longest visible wait in the product ("Ingesting…" phase).
- Fix: batch in chunks of ~100: one `upsert` for shared_links, one for bookmarks, one `IN`-query for cached vectors, check cancellation once per chunk (embedding already caches this via `createPipelineCancellationLookupCache` — reuse it here).
- Files: `apps/backend/src/queues/ingest.ts`.
- Risk: medium (rework of the loop; keep per-item error accounting via returned rows).

**10. Clustering job does all LLM work inline — timeout exposure**
- Issue: naming + refinement calls run inside the single clustering Lambda/job with retries up to 5×(backoff) each. Large collections can push past queue/Lambda timeouts; a timeout mid-run leaves partial clusters persisted (assignments written per-leaf as recursion proceeds).
- User impact: half-organized results shown as done, or failed runs after minutes of waiting.
- Fix (contained): write clusters/assignments only after the full tree is computed (build in memory, persist in one pass), so a crash leaves nothing partial; and cap total naming calls (name only top 2 levels with AI, heuristics below).
- Files: `queues/clustering.ts`, `clusterPersistence.ts`.
- Risk: medium.

**11. Status polling cost**
- Issue: legacy path (`loadLegacyStatusCounts`) fires 7 count queries per poll, every 2s per active user.
- Fix: single RPC mirroring `get_pipeline_run_status_counts` for the legacy path, or drop the legacy path once runs are all pipeline-tracked; back off polling to 5s after 60s.
- Files: `routes/status.ts`, `useWeaveRun.ts`.
- Risk: low.

### P3 — Product gaps

**12. Semantic search is built but unreachable**
- `/search` + `search_bookmarks` RPC (pgvector, service-role-gated) exist; no extension or web UI calls them. That's the most differentiating feature in the codebase sitting dead. Add a search box on ResultsScreen/dashboard `links` page. Files: `apps/extension/src/screens/ResultsScreen.tsx` or `apps/web/app/dashboard/links`. Risk: low.

**13. No tagging**
- No tag model exists anywhere. Don't build a full tag system yet — persisting cluster `keywords` (finding 6) gives 80% of the value (filter/search by keyword) with no new UX surface. Revisit real tags only if users ask.

**14. Destructive full-rebuild ingest**
- Every run wipes `bookmarks`/`clusters` (`clear_user_ingest_structure`) and re-ingests. Shared vector cache makes this cheap-ish, but it forfeits incremental runs ("organize just my 40 new bookmarks") and any learning from user edits. Long-term: diff Chrome tree against stored bookmarks, only ingest new/changed URLs, and treat user's post-apply folder moves as pinned assignments future runs must respect. This is the single biggest "genuinely helpful over time" investment. Risk: high — schedule after P0–P2.

---

## Implementation checklist

### Quick wins (day-scale, ship first)
- [x] Add `.order('id')` to clustering fetch pagination (`clusterPersistence.ts`)
- [x] Add `jobGeneration` to embedding job data (`enrichment.ts`)
- [x] Remove `appendFileSync` logging; delete committed `clustering-debug.log`; gitignore it (`clustering.ts`)
- [x] Seed k-means + sort input ids for deterministic runs (`clusterAlgorithm.ts`, `clustering.ts`)
- [x] Harden `normalizeBookmarkUrl` (lowercase host, strip tracking params) and reuse everywhere

### Core sorting improvements
- [ ] Persist cluster `keywords` + assignment `distance_to_centroid` (migration + `clusterPersistence.ts`)
- [ ] Surface keywords + low-confidence badges in preview (`structurePreviewBuilder.ts`, `BookmarkTree.tsx`)
- [x] Add `maxDepth` to density profiles; flat fan-out at max depth
- [x] Deterministic ordering of LLM merge application (`clusterRefinement.ts`)
- [ ] Compute full tree in memory, persist once (crash-safe clustering)

### UX polish
- [ ] Editable preview: inline folder rename + "Move to…" for bookmarks before Apply
- [ ] Duplicate grouping in preview with journaled (undoable) dedupe on Apply
- [x] Wire semantic search UI to existing `/search`
- [x] Make the pre-organize backup visible at Apply time ("A backup was saved — restore anytime from Backups")

### Reliability
- [x] Guard cleanup deletes: never `removeTree` folders containing un-planned bookmarks; snapshot deleted subtrees into journal for full rollback
- [x] Batch ingest (chunked upserts, single vector lookup, cached cancellation checks)
- [x] Legacy status counts → single RPC; polling backoff
- [x] Cap AI naming to top 2 tree levels; heuristics below

### Future enhancements
- [ ] Incremental ingest (diff against stored bookmarks; stop wiping per run)
- [ ] Pinned assignments: respect user's manual folder placements on re-runs
- [ ] Keyword-based filtering in results (precursor to tags)
- [ ] Cross-instance name cache / rate limiter (replace in-process `clusterNameCache`)
