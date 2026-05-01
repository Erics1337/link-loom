ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cluster_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structure_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own profile"
ON public.users
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can manage their own bookmarks"
ON public.bookmarks
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage their own clusters"
ON public.clusters
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage assignments for their own bookmarks and clusters"
ON public.cluster_assignments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.clusters c
    JOIN public.bookmarks b ON b.id = cluster_assignments.bookmark_id
    WHERE c.id = cluster_assignments.cluster_id
      AND c.user_id = auth.uid()
      AND b.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.clusters c
    JOIN public.bookmarks b ON b.id = cluster_assignments.bookmark_id
    WHERE c.id = cluster_assignments.cluster_id
      AND c.user_id = auth.uid()
      AND b.user_id = auth.uid()
  )
);

CREATE POLICY "Authenticated users can read shared link cache"
ON public.shared_links
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can manage their own structure snapshots"
ON public.structure_snapshots
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage clusters inside their own snapshots"
ON public.snapshot_clusters
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.structure_snapshots s
    WHERE s.id = snapshot_clusters.snapshot_id
      AND s.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.structure_snapshots s
    WHERE s.id = snapshot_clusters.snapshot_id
      AND s.user_id = auth.uid()
  )
);

CREATE POLICY "Users can manage assignments inside their own snapshots"
ON public.snapshot_assignments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.snapshot_clusters sc
    JOIN public.structure_snapshots s ON s.id = sc.snapshot_id
    JOIN public.bookmarks b ON b.id = snapshot_assignments.bookmark_id
    WHERE sc.id = snapshot_assignments.snapshot_cluster_id
      AND s.user_id = auth.uid()
      AND b.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.snapshot_clusters sc
    JOIN public.structure_snapshots s ON s.id = sc.snapshot_id
    JOIN public.bookmarks b ON b.id = snapshot_assignments.bookmark_id
    WHERE sc.id = snapshot_assignments.snapshot_cluster_id
      AND s.user_id = auth.uid()
      AND b.user_id = auth.uid()
  )
);
