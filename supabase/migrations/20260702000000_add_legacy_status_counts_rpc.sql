-- Legacy (non-pipeline-tracked) status counts in a single round trip.
-- Mirrors get_pipeline_run_status_counts but without the pipeline_run filter;
-- replaces the 7 parallel count queries the /status route fired per poll.
CREATE OR REPLACE FUNCTION public.get_legacy_status_counts(
  p_user_id UUID
)
RETURNS TABLE (
  total_bookmarks INTEGER,
  pending_bookmarks INTEGER,
  enriched_bookmarks INTEGER,
  embedded_bookmarks INTEGER,
  errored_bookmarks INTEGER,
  assigned_bookmarks INTEGER,
  cluster_count INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(bookmark_counts.total_bookmarks, 0)::integer AS total_bookmarks,
    COALESCE(bookmark_counts.pending_bookmarks, 0)::integer AS pending_bookmarks,
    COALESCE(bookmark_counts.enriched_bookmarks, 0)::integer AS enriched_bookmarks,
    COALESCE(bookmark_counts.embedded_bookmarks, 0)::integer AS embedded_bookmarks,
    COALESCE(bookmark_counts.errored_bookmarks, 0)::integer AS errored_bookmarks,
    COALESCE(assignment_counts.assigned_bookmarks, 0)::integer AS assigned_bookmarks,
    COALESCE(cluster_counts.cluster_count, 0)::integer AS cluster_count
  FROM (SELECT 1) seed
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS total_bookmarks,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_bookmarks,
      COUNT(*) FILTER (WHERE status = 'enriched') AS enriched_bookmarks,
      COUNT(*) FILTER (WHERE status = 'embedded') AS embedded_bookmarks,
      COUNT(*) FILTER (WHERE status = 'error') AS errored_bookmarks
    FROM public.bookmarks
    WHERE user_id = p_user_id
  ) bookmark_counts ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT ca.bookmark_id) AS assigned_bookmarks
    FROM public.cluster_assignments ca
    JOIN public.clusters c ON c.id = ca.cluster_id
    WHERE c.user_id = p_user_id
  ) assignment_counts ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cluster_count
    FROM public.clusters
    WHERE user_id = p_user_id
  ) cluster_counts ON TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_legacy_status_counts(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_legacy_status_counts(UUID) TO service_role;
