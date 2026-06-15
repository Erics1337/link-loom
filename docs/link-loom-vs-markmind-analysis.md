# Link Loom vs MarkMind Architecture Deep Dive

Sources inspected:

- Link Loom local repo at `/Users/ericswanson/code/extensions-plugins/link-loom`
- MarkMind GitHub repo: https://github.com/migsilva89/MarkMind
- MarkMind source cloned read-only to `/tmp/MarkMind`

Editable diagrams:

- [Link Loom vs MarkMind Excalidraw](./link-loom-vs-markmind-architecture.excalidraw)

## Executive Summary

Link Loom and MarkMind solve adjacent bookmark organization problems, but their architectures are nearly opposite.

Link Loom is a product platform: Chrome extension plus Next.js web app plus Fastify backend plus Supabase/Postgres plus queue/Lambda worker pipeline plus Stripe billing. The extension is the user-facing control plane and Chrome write agent, while the backend owns ingestion, enrichment, embedding, clustering, snapshots, search, limits, and recovery.

MarkMind is a self-contained Chrome extension: React popup, MV3 service worker, Chrome local storage, Chrome bookmark APIs, and direct calls from the extension to user-selected AI providers. There is no first-party backend, no persistent server database, and no account or billing system in the inspected repository.

## High-Level Architecture

| Area | Link Loom | MarkMind |
| --- | --- | --- |
| Repo structure | Turborepo monorepo with `apps/extension`, `apps/backend`, `apps/web`, shared packages, infra, Supabase migrations | Single Vite/React extension repo under `src/` |
| Runtime shape | Distributed SaaS-style system | Local-first browser extension |
| AI boundary | Backend calls OpenAI for embeddings and cluster names | Extension calls Gemini/OpenAI/Anthropic/OpenRouter/custom providers directly |
| Data storage | Supabase Postgres with users, bookmarks, shared link embedding cache, clusters, assignments, snapshots, devices | `chrome.storage.local` for API keys, selected provider/model, sessions, onboarding/theme state |
| Apply phase | Extension applies generated backend structure to Chrome bookmarks with journaling/recovery | Extension applies approved LLM assignments directly with Chrome bookmark APIs |
| Auth | Supabase auth, anonymous/permanent extension sessions, web login, external extension auth handoff | No app account required; user stores provider API keys locally |
| Monetization | Stripe checkout/webhooks and premium flags in `users` | None in repo |
| Scaling strategy | Queue pipeline with inline/test/SQS drivers; production uses SQS/Lambda | Single user/browser runtime; bounded by popup/service-worker/provider limits |
| Privacy posture | Bookmark data and derived embeddings live in Link Loom backend; server-side billing/device controls | Bookmark data stays in browser except prompt payloads sent to chosen AI provider |

## Link Loom Flow

The extension obtains or resumes a processing identity, scans Chrome bookmarks, saves a safety backup, sends bookmarks to `/ingest`, polls `/status/:userId`, fetches `/structure/:userId`, lets the user preview, then applies Chrome mutations locally.

Key implementation references:

- Extension identity/resume/polling logic: [apps/extension/src/hooks/useWeaveRun.ts](/Users/ericswanson/code/extensions-plugins/link-loom/apps/extension/src/hooks/useWeaveRun.ts:88)
- Ingest API and premium limit gate: [apps/backend/src/routes/ingest.ts](/Users/ericswanson/code/extensions-plugins/link-loom/apps/backend/src/routes/ingest.ts:27)
- Queue abstraction for inline/test/SQS: [apps/backend/src/lib/queue.ts](/Users/ericswanson/code/extensions-plugins/link-loom/apps/backend/src/lib/queue.ts:37)
- Recursive k-means split logic: [apps/backend/src/queues/clustering/clusterAlgorithm.ts](/Users/ericswanson/code/extensions-plugins/link-loom/apps/backend/src/queues/clustering/clusterAlgorithm.ts:109)
- Chrome apply plan and recovery machinery: [apps/extension/src/lib/chromeApplyPlan.ts](/Users/ericswanson/code/extensions-plugins/link-loom/apps/extension/src/lib/chromeApplyPlan.ts:242)
- MV3 manifest host/app boundary: [apps/extension/manifest.json](/Users/ericswanson/code/extensions-plugins/link-loom/apps/extension/manifest.json:20)

## MarkMind Flow

MarkMind scans the local bookmark tree, lets the user select bookmarks, sends the selected bookmark list and folder tree to an LLM through the selected provider, stores the resulting folder plan and assignments in Chrome local storage, lets the user review, then creates/moves bookmarks locally.

Key implementation references from the cloned repo:

- MV3 service worker keeps the organize run alive and calls `organizeBookmarks`: `/tmp/MarkMind/src/background.ts:15`
- Bulk scan and send-to-background flow: `/tmp/MarkMind/src/hooks/useBulkOrganize/useBulkOrganize.ts:180`
- LLM JSON response parsing into folder plan and assignments: `/tmp/MarkMind/src/services/ai/bulkOrganize.ts:28`
- Single-bookmark “organize current page” hook: `/tmp/MarkMind/src/hooks/useOrganizeBookmark/useOrganizeBookmark.ts:16`
- Manifest permissions and provider host permissions: `/tmp/MarkMind/src/manifest.json:23`

## Algorithmic Difference

Link Loom is embedding-first. It enriches URLs, computes OpenAI embeddings, caches vectors globally by URL hash in `shared_links`, recursively partitions vectors with k-means, then names clusters. This is better suited for hundreds or thousands of bookmarks, repeat runs, semantic similarity search, and backend observability.

MarkMind is prompt-first. It asks the selected LLM to propose the folder plan and per-bookmark assignments directly from compact bookmark metadata and the existing folder tree. This is simpler, transparent, and provider-flexible, but it places more correctness and scaling pressure on prompt length, JSON validity, model output quality, and the browser service worker lifecycle.

## Structural Implications

Link Loom optimizes for product depth:

- Durable server-side state and cloud snapshots.
- Reusable embedding cache across users.
- Search, dead-link tools, duplicate tools, device limits, billing, and dashboards.
- More complex failure modes: queues, DB consistency, cancellation, pipeline generations, auth, and apply recovery.

MarkMind optimizes for local trust and simplicity:

- No backend infrastructure to operate.
- User chooses provider and keeps API key locally.
- Direct, easy-to-follow code paths.
- More limited central product capabilities: no cross-device account state, no shared cache, no first-party recovery store, no server-side progress model.

## Where Link Loom Can Learn From MarkMind

- MarkMind’s provider abstraction is clean and user-friendly. Link Loom could eventually expose provider choice, even if the backend remains the execution boundary.
- MarkMind has a focused “organize current page” path. Link Loom’s architecture is stronger for bulk organization, but a quick-save flow could be lower friction.
- MarkMind’s local-first story is easier to explain. Link Loom should be very explicit in product copy about what is sent to the backend and why.

## Where MarkMind Is Thinner Than Link Loom

- It lacks a backend data model for durable snapshots, server search, shared embedding reuse, billing, and account/device state.
- Bulk organization is one LLM-generated JSON plan; Link Loom’s staged pipeline can recover and report granular progress.
- MarkMind relies on extension-side provider permissions and local API keys, while Link Loom centralizes API-key custody server-side.

## Bottom Line

Link Loom is architected like a durable bookmark organization service with a Chrome extension client. MarkMind is architected like a privacy-forward, local-first AI assistant embedded inside Chrome. Link Loom has higher operational complexity but much more room for product features and scale; MarkMind has lower infrastructure risk and a simpler trust model but less durable backend leverage.
