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
