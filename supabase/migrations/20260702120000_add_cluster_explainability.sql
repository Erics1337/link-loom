ALTER TABLE public.clusters
  ADD COLUMN IF NOT EXISTS keywords TEXT[];

ALTER TABLE public.cluster_assignments
  ADD COLUMN IF NOT EXISTS distance_to_centroid DOUBLE PRECISION;

COMMENT ON COLUMN public.clusters.keywords IS
  'Top tokens extracted from bookmark titles/descriptions in this cluster (and its descendants), surfaced as a folder tooltip so users can see why bookmarks were grouped together.';

COMMENT ON COLUMN public.cluster_assignments.distance_to_centroid IS
  'Squared distance from this bookmark''s embedding to its leaf cluster centroid at assignment time; the preview UI flags the farthest bookmarks per folder as "low confidence".';
