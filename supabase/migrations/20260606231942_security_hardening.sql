-- Bookmark structure snapshots
CREATE TABLE IF NOT EXISTS structure_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
DECLARE
  v_null_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'structure_snapshots'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) THEN
    SELECT count(*) INTO v_null_count
    FROM public.structure_snapshots
    WHERE user_id IS NULL;

    IF v_null_count > 0 THEN
      RAISE EXCEPTION
        'structure_snapshots.user_id NOT NULL migration blocked: % row(s) have NULL user_id',
        v_null_count;
    END IF;

    ALTER TABLE public.structure_snapshots
      ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS snapshot_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES structure_snapshots(id) ON DELETE CASCADE,
  original_cluster_id UUID NOT NULL,
  name TEXT,
  parent_id UUID REFERENCES snapshot_clusters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_assignments (
  snapshot_cluster_id UUID REFERENCES snapshot_clusters(id) ON DELETE CASCADE,
  bookmark_id UUID REFERENCES bookmarks(id) ON DELETE CASCADE,
  PRIMARY KEY (snapshot_cluster_id, bookmark_id)
);

CREATE INDEX IF NOT EXISTS idx_structure_snapshots_user_id ON structure_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_clusters_snapshot_id ON snapshot_clusters(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_clusters_parent_id ON snapshot_clusters(parent_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_assignments_bookmark_id ON snapshot_assignments(bookmark_id);

CREATE OR REPLACE FUNCTION public.assert_snapshot_rpc_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'Snapshot user does not match authenticated user';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_structure_snapshot(p_user_id UUID, p_snapshot_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_snapshot_id UUID;
BEGIN
    PERFORM public.assert_snapshot_rpc_user(p_user_id);

    INSERT INTO public.structure_snapshots (user_id, name)
    VALUES (p_user_id, p_snapshot_name)
    RETURNING id INTO v_snapshot_id;

    INSERT INTO public.snapshot_clusters (snapshot_id, original_cluster_id, name, parent_id)
    SELECT v_snapshot_id, id, name, NULL
    FROM public.clusters
    WHERE user_id = p_user_id;

    UPDATE public.snapshot_clusters sc
    SET parent_id = parent_sc.id
    FROM public.clusters c
    JOIN public.snapshot_clusters parent_sc
      ON parent_sc.snapshot_id = v_snapshot_id
     AND parent_sc.original_cluster_id = c.parent_id
    WHERE sc.snapshot_id = v_snapshot_id
      AND sc.original_cluster_id = c.id;

    INSERT INTO public.snapshot_assignments (snapshot_cluster_id, bookmark_id)
    SELECT sc.id, ca.bookmark_id
    FROM public.cluster_assignments ca
    JOIN public.clusters c ON c.id = ca.cluster_id
    JOIN public.snapshot_clusters sc
      ON sc.snapshot_id = v_snapshot_id
     AND sc.original_cluster_id = c.id
    JOIN public.bookmarks b ON b.id = ca.bookmark_id
    WHERE c.user_id = p_user_id
      AND b.user_id = p_user_id;

    RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_structure_snapshot(p_user_id UUID, p_snapshot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.assert_snapshot_rpc_user(p_user_id);

    IF NOT EXISTS (
        SELECT 1
        FROM public.structure_snapshots
        WHERE id = p_snapshot_id
          AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Snapshot not found or does not belong to user';
    END IF;

    DELETE FROM public.clusters WHERE user_id = p_user_id;

    INSERT INTO public.clusters (id, user_id, name, parent_id)
    SELECT original_cluster_id, p_user_id, name, NULL
    FROM public.snapshot_clusters
    WHERE snapshot_id = p_snapshot_id;

    UPDATE public.clusters cur
    SET parent_id = parent_sc.original_cluster_id
    FROM public.snapshot_clusters sc
    JOIN public.snapshot_clusters parent_sc ON parent_sc.id = sc.parent_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND cur.user_id = p_user_id
      AND cur.id = sc.original_cluster_id;

    INSERT INTO public.cluster_assignments (cluster_id, bookmark_id)
    SELECT sc.original_cluster_id, sa.bookmark_id
    FROM public.snapshot_assignments sa
    JOIN public.snapshot_clusters sc ON sc.id = sa.snapshot_cluster_id
    JOIN public.bookmarks b ON b.id = sa.bookmark_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND b.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_snapshot_rpc_user(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_structure_snapshot(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_structure_snapshot(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_structure_snapshot(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_structure_snapshot(UUID, UUID) TO authenticated, service_role;

-- Security hardening: RLS, account roles, device limits
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_role TEXT NOT NULL DEFAULT 'user',
  ADD CONSTRAINT users_account_role_check
    CHECK (account_role IN ('user', 'admin'));

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cluster_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structure_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pipeline_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_run_untracked_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_run_terminal_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_job_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.bookmarks FROM anon, authenticated;
REVOKE ALL ON TABLE public.clusters FROM anon, authenticated;
REVOKE ALL ON TABLE public.cluster_assignments FROM anon, authenticated;
REVOKE ALL ON TABLE public.shared_links FROM anon, authenticated;
REVOKE ALL ON TABLE public.structure_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.snapshot_clusters FROM anon, authenticated;
REVOKE ALL ON TABLE public.snapshot_assignments FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_devices FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_pipeline_controls FROM anon, authenticated;
REVOKE ALL ON TABLE public.pipeline_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.pipeline_run_untracked_errors FROM anon, authenticated;
REVOKE ALL ON TABLE public.pipeline_run_terminal_bookmarks FROM anon, authenticated;
REVOKE ALL ON TABLE public.queue_job_failures FROM anon, authenticated;

GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bookmarks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clusters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cluster_assignments TO authenticated;
GRANT SELECT ON TABLE public.shared_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.structure_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.snapshot_clusters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.snapshot_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_devices TO authenticated;
GRANT SELECT ON TABLE public.user_pipeline_controls TO authenticated;
GRANT SELECT ON TABLE public.pipeline_runs TO authenticated;
GRANT SELECT ON TABLE public.queue_job_failures TO authenticated;

DROP POLICY IF EXISTS "Users can read their own profile" ON public.users;
CREATE POLICY "Users can read their own profile"
ON public.users
FOR SELECT
TO authenticated
USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own bookmarks" ON public.bookmarks;
CREATE POLICY "Users can manage their own bookmarks"
ON public.bookmarks
FOR ALL
TO authenticated
USING (user_id = (select auth.uid()))
WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own clusters" ON public.clusters;
CREATE POLICY "Users can manage their own clusters"
ON public.clusters
FOR ALL
TO authenticated
USING (user_id = (select auth.uid()))
WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can manage assignments for their own bookmarks and clusters" ON public.cluster_assignments;
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
      AND c.user_id = (select auth.uid())
      AND b.user_id = (select auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.clusters c
    JOIN public.bookmarks b ON b.id = cluster_assignments.bookmark_id
    WHERE c.id = cluster_assignments.cluster_id
      AND c.user_id = (select auth.uid())
      AND b.user_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS "Authenticated users can read shared link cache" ON public.shared_links;
CREATE POLICY "Authenticated users can read shared link cache"
ON public.shared_links
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can manage their own structure snapshots" ON public.structure_snapshots;
CREATE POLICY "Users can manage their own structure snapshots"
ON public.structure_snapshots
FOR ALL
TO authenticated
USING (user_id = (select auth.uid()))
WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can manage clusters inside their own snapshots" ON public.snapshot_clusters;
CREATE POLICY "Users can manage clusters inside their own snapshots"
ON public.snapshot_clusters
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.structure_snapshots s
    WHERE s.id = snapshot_clusters.snapshot_id
      AND s.user_id = (select auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.structure_snapshots s
    WHERE s.id = snapshot_clusters.snapshot_id
      AND s.user_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can manage assignments inside their own snapshots" ON public.snapshot_assignments;
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
      AND s.user_id = (select auth.uid())
      AND b.user_id = (select auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.snapshot_clusters sc
    JOIN public.structure_snapshots s ON s.id = sc.snapshot_id
    JOIN public.bookmarks b ON b.id = snapshot_assignments.bookmark_id
    WHERE sc.id = snapshot_assignments.snapshot_cluster_id
      AND s.user_id = (select auth.uid())
      AND b.user_id = (select auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can view their own devices" ON public.user_devices;
CREATE POLICY "Users can view their own devices"
ON public.user_devices
FOR SELECT
TO authenticated
USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own devices" ON public.user_devices;
CREATE POLICY "Users can delete their own devices"
ON public.user_devices
FOR DELETE
TO authenticated
USING (user_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.enforce_device_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_device_count INTEGER;
BEGIN
  PERFORM 1
  FROM public.users
  WHERE id = NEW.user_id
  FOR UPDATE;

  SELECT count(*)
  INTO v_device_count
  FROM public.user_devices
  WHERE user_id = NEW.user_id;

  IF v_device_count >= 3 THEN
    RAISE EXCEPTION 'Device limit reached. Please manage devices in dashboard.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_device_limit ON public.user_devices;

CREATE TRIGGER check_device_limit
  BEFORE INSERT ON public.user_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_device_limit();

DROP POLICY IF EXISTS "Users can register their own device" ON public.user_devices;
CREATE POLICY "Users can register their own device"
ON public.user_devices
FOR INSERT
TO authenticated
WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update their own devices" ON public.user_devices;
CREATE POLICY "Users can update their own devices"
ON public.user_devices
FOR UPDATE
TO authenticated
USING (user_id = (select auth.uid()))
WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can read their own pipeline controls" ON public.user_pipeline_controls;
CREATE POLICY "Users can read their own pipeline controls"
ON public.user_pipeline_controls
FOR SELECT
TO authenticated
USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can read their own pipeline runs" ON public.pipeline_runs;
CREATE POLICY "Users can read their own pipeline runs"
ON public.pipeline_runs
FOR SELECT
TO authenticated
USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can read their own queue job failures" ON public.queue_job_failures;
CREATE POLICY "Users can read their own queue job failures"
ON public.queue_job_failures
FOR SELECT
TO authenticated
USING (user_id = (select auth.uid()));

COMMENT ON COLUMN public.users.account_role IS
  'Server-managed authorization role. Do not derive authorization from user-editable auth metadata.';

-- Shared rate limiting (service-role only)
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  rate_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limit_buckets TO service_role;

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at
ON public.rate_limit_buckets (reset_at);

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_rate_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
  current_reset_at TIMESTAMPTZ;
  now_at TIMESTAMPTZ := NOW();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'consume_rate_limit requires service_role';
  END IF;

  IF p_rate_key IS NULL OR p_rate_key = '' OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit arguments';
  END IF;

  INSERT INTO public.rate_limit_buckets (rate_key, count, reset_at, updated_at)
  VALUES (p_rate_key, 1, now_at + make_interval(secs => p_window_seconds), now_at)
  ON CONFLICT (rate_key) DO UPDATE
    SET
      count = CASE
        WHEN public.rate_limit_buckets.reset_at <= now_at THEN 1
        ELSE public.rate_limit_buckets.count + 1
      END,
      reset_at = CASE
        WHEN public.rate_limit_buckets.reset_at <= now_at THEN now_at + make_interval(secs => p_window_seconds)
        ELSE public.rate_limit_buckets.reset_at
      END,
      updated_at = now_at
  RETURNING count, reset_at
  INTO current_count, current_reset_at;

  RETURN QUERY SELECT
    current_count <= p_limit,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (current_reset_at - now_at)))::integer);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON TABLE public.rate_limit_buckets IS
  'Shared service-role-only counters for application-level rate limiting.';

CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limit_buckets(
  p_retention INTERVAL DEFAULT INTERVAL '1 day'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cleanup_expired_rate_limit_buckets requires service_role';
  END IF;

  DELETE FROM public.rate_limit_buckets
  WHERE reset_at < NOW() - p_retention;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limit_buckets(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limit_buckets(INTERVAL) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-rate-limit-buckets');
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%could not find valid entry%' THEN
      RAISE;
    END IF;
END;
$$;

SELECT cron.schedule(
  'cleanup-rate-limit-buckets',
  '0 * * * *',
  $$DELETE FROM public.rate_limit_buckets WHERE reset_at < NOW() - INTERVAL '1 day'$$
);

-- Clear user ingest structure (service-role only)
CREATE OR REPLACE FUNCTION public.clear_user_ingest_structure(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'clear_user_ingest_structure requires service_role';
  END IF;

  DELETE FROM public.bookmarks
  WHERE user_id = p_user_id;

  DELETE FROM public.clusters
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_user_ingest_structure(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_user_ingest_structure(UUID) TO service_role;

-- search_bookmarks: service-role-only RPC (backend supplies user_id).
CREATE OR REPLACE FUNCTION public.search_bookmarks(
    query_vector vector(1536),
    user_id uuid,
    match_count int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    url text,
    title text,
    description text,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'search_bookmarks is restricted to service_role';
    END IF;

    RETURN QUERY
    SELECT
        b.id,
        b.url,
        b.title,
        s.description,
        1 - (s.vector <=> query_vector) AS similarity
    FROM public.bookmarks b
    JOIN public.shared_links s ON b.content_hash = s.id
    WHERE b.user_id = search_bookmarks.user_id
    ORDER BY s.vector <=> query_vector
    LIMIT match_count;
END;
$$;

REVOKE ALL ON FUNCTION public.search_bookmarks(vector(1536), uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_bookmarks(vector(1536), uuid, integer) TO service_role;

-- Backfill nullable bookmark/cluster columns on databases created before NOT NULL constraints.
DO $$
DECLARE
  v_null_count BIGINT;
BEGIN
  UPDATE public.bookmarks SET status = 'pending' WHERE status IS NULL;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookmarks'
      AND column_name = 'status'
      AND is_nullable = 'YES'
  ) THEN
    SELECT count(*) INTO v_null_count
    FROM public.bookmarks
    WHERE status IS NULL;

    IF v_null_count > 0 THEN
      RAISE EXCEPTION
        'bookmarks.status NOT NULL migration blocked: % row(s) have NULL status',
        v_null_count;
    END IF;

    ALTER TABLE public.bookmarks
      ALTER COLUMN status SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookmarks'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) THEN
    SELECT count(*) INTO v_null_count
    FROM public.bookmarks
    WHERE user_id IS NULL;

    IF v_null_count > 0 THEN
      RAISE EXCEPTION
        'bookmarks.user_id NOT NULL migration blocked: % row(s) have NULL user_id',
        v_null_count;
    END IF;

    ALTER TABLE public.bookmarks
      ALTER COLUMN user_id SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clusters'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) THEN
    SELECT count(*) INTO v_null_count
    FROM public.clusters
    WHERE user_id IS NULL;

    IF v_null_count > 0 THEN
      RAISE EXCEPTION
        'clusters.user_id NOT NULL migration blocked: % row(s) have NULL user_id',
        v_null_count;
    END IF;

    ALTER TABLE public.clusters
      ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;
