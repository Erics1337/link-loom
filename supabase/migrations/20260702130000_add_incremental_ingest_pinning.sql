-- Incremental ingest + pinned manual placements (UX audit finding 14).
-- Adds durable identity for the Chrome folder a cluster maps to, the Chrome
-- folder a bookmark currently lives in, and whether a bookmark's placement
-- was manually confirmed by the user (and must survive future re-clustering).

ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS chrome_parent_id TEXT;

ALTER TABLE public.clusters
  ADD COLUMN IF NOT EXISTS chrome_folder_id TEXT;

ALTER TABLE public.cluster_assignments
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_clusters_user_chrome_folder
  ON public.clusters(user_id, chrome_folder_id)
  WHERE chrome_folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cluster_assignments_pinned
  ON public.cluster_assignments(bookmark_id)
  WHERE is_pinned;

-- Clears only the non-pinned assignments for a user before a clustering run,
-- then prunes clusters left with zero assignments. Pinned assignments (and
-- the clusters/folders that hold them) are left untouched, unlike the older
-- clear_user_ingest_structure() which wiped everything.
CREATE OR REPLACE FUNCTION public.clear_unpinned_cluster_assignments(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'clear_unpinned_cluster_assignments requires service_role';
  END IF;

  DELETE FROM public.cluster_assignments ca
  USING public.bookmarks b
  WHERE ca.bookmark_id = b.id
    AND b.user_id = p_user_id
    AND ca.is_pinned = FALSE;

  DELETE FROM public.clusters c
  WHERE c.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.cluster_assignments ca WHERE ca.cluster_id = c.id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.clear_unpinned_cluster_assignments(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_unpinned_cluster_assignments(UUID) TO service_role;

-- Corrects a running pipeline run's tracked bookmark total once diff-based
-- ingest knows how many bookmarks actually need (re-)embedding this run —
-- the route only knows the full scan size before the worker diffs it against
-- what's already stored. Mirrors record_user_pipeline_ingest_completed's
-- style (same migration family, apps/backend/src/lib/pipelineCoordinator.ts).
CREATE OR REPLACE FUNCTION public.record_user_pipeline_ingest_total(
  p_user_id UUID,
  p_job_generation BIGINT,
  p_total_bookmarks INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_runs
  SET totals = totals || jsonb_build_object('total', GREATEST(p_total_bookmarks, 0))
  WHERE user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running';
END;
$$;
