# Link Loom Clustering + Rename Refactor PRD

Author: Codex
Date: 2026-02-18
Status: Draft (Implementation Started)

## 1. Summary
Link Loom currently creates folder structures from embeddings using fixed recursive k-means and generates folder names with a mixed heuristic/LLM path. This refactor improves cluster quality, introduces user-facing controls for cluster density and naming style, and implements a production-ready foundation for automatic bookmark renaming.

## 2. Problem Statement
Current behavior has four quality gaps:
- Root/small-library assignment can fail for small datasets (`<= 5` bookmarks at root), causing unassigned bookmarks.
- Recursive splitting uses a fixed `k=min(5,n)`, which can produce noisy or over-fragmented folder trees.
- Folder naming context is limited and can be generic.
- Auto-rename exists in UI as a placeholder and is not operational.

## 3. Goals
- Improve semantic grouping quality and reduce meaningless folder fragmentation.
- Guarantee assignment invariants: each embedded bookmark is assigned exactly once.
- Add user controls to tune organization outcomes without requiring technical knowledge.
- Create a robust rename pipeline that produces high-confidence, findable bookmark titles.
- Keep costs and latency bounded with caching, batching, and fallback behavior.

## 4. Non-Goals (Phase 1)
- Full database-side clustering rewrite.
- Real-time websocket progress stream.
- Full semantic search redesign.

## 5. User Experience Requirements

### 5.1 New Controls
Expose these controls in extension settings and apply them per run:
- Folder density:
  - Less folders
  - Medium (default)
  - More folders
- Folder naming tone:
  - Clear (default)
  - Balanced
  - Playful
- Organization mode:
  - Topic-first (default)
  - Category-first

### 5.2 Design Principles
- Defaults must produce stable, highly findable structures.
- Playful naming must remain searchable and understandable.
- User controls should be lightweight presets, not low-level algorithm knobs.

## 6. Functional Requirements

### 6.1 Clustering Pipeline
- Accept run-level clustering settings in `/ingest` request body.
- Pass settings through ingest queue -> clustering queue.
- Replace fixed split behavior with adaptive branching based on density profile.
- Enforce minimum child size and avoid tiny singleton folders where possible.
- Ensure root and small-library handling always creates assignable parent cluster nodes.

### 6.2 Folder Naming
- Generate names using richer sampled context from each cluster.
- Tone-aware prompt behavior:
  - Clear: direct and literal labels.
  - Balanced: concise with slight personality.
  - Playful: creative names but with clear category signal.
- Continue heuristic fallback when AI unavailable or cluster too small.

### 6.3 Bookmark Auto-Rename (Phased)
- Store suggested title in `bookmarks.ai_title`.
- Add rename suggestion generation endpoint/worker step.
- Add extension preview and apply path using `chrome.bookmarks.update`.
- Use confidence and safety gating to avoid harmful renames.

## 7. Technical Design

### 7.1 Settings Contract
Introduce shared settings contract:
```ts
type FolderDensity = 'less' | 'medium' | 'more';
type NamingTone = 'clear' | 'balanced' | 'playful';
type OrganizationMode = 'topic' | 'category';

interface ClusteringSettings {
  folderDensity: FolderDensity;
  namingTone: NamingTone;
  organizationMode: OrganizationMode;
}
```

Default settings:
- `folderDensity='medium'`
- `namingTone='clear'`
- `organizationMode='topic'`

### 7.2 Adaptive Clustering (Phase 1)
- Use density profile to derive:
  - target leaf size,
  - max children per split,
  - minimum child size.
- Determine `k` dynamically from cluster size and profile.
- If node is root and below leaf threshold, create a root cluster and assign bookmarks.
- If split produces tiny groups, rebalance or stop splitting.

### 7.3 Naming Behavior
- Increase context sample size (bounded cap).
- Prompt includes tone + organization mode guidance.
- Preserve retries/backoff and concurrency limits.

## 8. Data Model and API Changes

### 8.1 Backend API
`POST /ingest` request adds optional field:
```json
{
  "userId": "...",
  "bookmarks": [...],
  "clusteringSettings": {
    "folderDensity": "medium",
    "namingTone": "clear",
    "organizationMode": "topic"
  }
}
```

### 8.2 Storage
- Phase 1: store settings client-side (extension local storage), send per-run.
- Optional Phase 2+: persist default settings server-side per user.

## 9. Rollout Plan

### Phase 1 (start now)
- PRD and implementation foundation.
- Root assignment bug fix.
- Adaptive split with density profile.
- Tone-aware folder naming prompts.
- Extension settings UI + storage + ingest wiring.

### Phase 2
- Rename suggestion generation service.
- Results preview for rename suggestions.
- Apply flow integration for renaming.

### Phase 3
- Quality scoring (silhouette/cluster cohesion), post-merge refinements.
- Experiment framework and benchmark suite.

## 10. Success Metrics
- Assignment coverage: 100% embedded bookmarks assigned.
- Structure quality proxy: fewer single-bookmark folders under medium profile.
- User control effectiveness: measurable folder-count delta across density presets.
- Naming quality: reduction in generic labels.
- Rename adoption (Phase 2+): percent of suggestions accepted/applied.

## 11. Risks and Mitigations
- Risk: More settings increase complexity.
  - Mitigation: preset-only controls and strong defaults.
- Risk: Playful names harm findability.
  - Mitigation: force explicit topical signal in generated names.
- Risk: Larger naming context raises latency/cost.
  - Mitigation: bounded samples, caching, and heuristic fallback.

## 12. Acceptance Criteria
- Small libraries (`1-5` bookmarks) always produce valid clusters and assignments.
- Folder density presets produce distinct folder-count behavior.
- Naming tone is reflected in output style without generic labels.
- Existing apply flow remains stable.
- No regressions in queue pipeline and status progression.
