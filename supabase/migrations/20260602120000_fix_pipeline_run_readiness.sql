ALTER TABLE public.user_pipeline_controls
ADD COLUMN IF NOT EXISTS job_generation BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  generation BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'cancelled', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, generation)
);

CREATE TABLE IF NOT EXISTS public.pipeline_run_untracked_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_generation BIGINT NOT NULL,
  error_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_generation, error_key)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_generation
ON public.pipeline_runs (user_id, generation DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_status
ON public.pipeline_runs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_untracked_errors_user_generation
ON public.pipeline_run_untracked_errors (user_id, job_generation);

ALTER TABLE public.user_pipeline_controls
ADD COLUMN IF NOT EXISTS current_pipeline_run_id UUID REFERENCES public.pipeline_runs(id) ON DELETE SET NULL;

UPDATE public.user_pipeline_controls controls
SET current_pipeline_run_id = latest_run.id
FROM (
  SELECT DISTINCT ON (user_id) id, user_id
  FROM public.pipeline_runs
  ORDER BY user_id, generation DESC
) latest_run
WHERE controls.user_id = latest_run.user_id
  AND controls.current_pipeline_run_id IS NULL;

ALTER TABLE public.user_pipeline_controls
DROP COLUMN IF EXISTS total_bookmarks,
DROP COLUMN IF EXISTS untracked_error_count,
DROP COLUMN IF EXISTS clustering_settings,
DROP COLUMN IF EXISTS ingest_completed_at,
DROP COLUMN IF EXISTS clustering_enqueued_at,
DROP COLUMN IF EXISTS clustering_completed_at;

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_run_untracked_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own pipeline runs" ON public.pipeline_runs;
CREATE POLICY "Users can read their own pipeline runs"
ON public.pipeline_runs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

GRANT SELECT ON public.pipeline_runs TO authenticated;
REVOKE ALL ON TABLE public.pipeline_run_untracked_errors FROM anon, authenticated;

ALTER TABLE public.bookmarks
ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES public.pipeline_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookmarks_pipeline_run_status
ON public.bookmarks (pipeline_run_id, status);

ALTER TABLE public.queue_job_failures
ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES public.pipeline_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_queue_job_failures_pipeline_run
ON public.queue_job_failures (pipeline_run_id);

DROP FUNCTION IF EXISTS public.begin_user_pipeline_run(UUID);

CREATE OR REPLACE FUNCTION public.begin_user_pipeline_run(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_generation BIGINT;
  next_run_id UUID;
BEGIN
  INSERT INTO public.user_pipeline_controls (user_id, is_cancelled, job_generation, updated_at)
  VALUES (p_user_id, FALSE, 1, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET job_generation = public.user_pipeline_controls.job_generation + 1,
        is_cancelled = FALSE,
        current_pipeline_run_id = NULL,
        updated_at = NOW()
  RETURNING job_generation INTO next_generation;

  UPDATE public.pipeline_runs
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, NOW())
  WHERE user_id = p_user_id
    AND status = 'running';

  INSERT INTO public.pipeline_runs (user_id, generation, status, started_at)
  VALUES (p_user_id, next_generation, 'running', NOW())
  RETURNING id INTO next_run_id;

  UPDATE public.user_pipeline_controls
  SET current_pipeline_run_id = next_run_id,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND job_generation = next_generation;

  RETURN jsonb_build_object(
    'id', next_run_id,
    'generation', next_generation
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_user_pipeline_started(
  p_user_id UUID,
  p_job_generation BIGINT,
  p_total_bookmarks INTEGER,
  p_clustering_settings JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_runs
  SET settings = COALESCE(p_clustering_settings, '{}'::jsonb),
      totals = jsonb_build_object(
        'total', GREATEST(p_total_bookmarks, 0),
        'untrackedErrors', 0
      )
  WHERE user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_user_pipeline_ingest_completed(
  p_user_id UUID,
  p_job_generation BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_runs
  SET totals = totals || jsonb_build_object('ingestCompletedAt', NOW())
  WHERE user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_user_pipeline_untracked_error(
  p_user_id UUID,
  p_job_generation BIGINT,
  p_error_key TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 1;
BEGIN
  IF p_error_key IS NOT NULL THEN
    INSERT INTO public.pipeline_run_untracked_errors (user_id, job_generation, error_key)
    VALUES (p_user_id, p_job_generation, p_error_key)
    ON CONFLICT (user_id, job_generation, error_key) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count = 0 THEN
      RETURN;
    END IF;
  END IF;

  UPDATE public.pipeline_runs
  SET totals = totals || jsonb_build_object(
        'untrackedErrors',
        COALESCE((totals->>'untrackedErrors')::integer, 0) + 1
      )
  WHERE user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_user_pipeline_clustering(
  p_user_id UUID,
  p_job_generation BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  control_row public.user_pipeline_controls%ROWTYPE;
  current_run public.pipeline_runs%ROWTYPE;
  terminal_count INTEGER;
  total_bookmarks INTEGER;
  untracked_error_count INTEGER;
BEGIN
  SELECT *
  INTO control_row
  FROM public.user_pipeline_controls
  WHERE user_id = p_user_id
    AND job_generation = p_job_generation
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF control_row.is_cancelled
     OR control_row.current_pipeline_run_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT *
  INTO current_run
  FROM public.pipeline_runs
  WHERE id = control_row.current_pipeline_run_id
    AND user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running'
  FOR UPDATE;

  IF current_run.id IS NULL
     OR current_run.totals->>'ingestCompletedAt' IS NULL
     OR current_run.totals->>'clusteringEnqueuedAt' IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*)
  INTO terminal_count
  FROM public.bookmarks
  WHERE user_id = p_user_id
    AND pipeline_run_id = current_run.id
    AND status IN ('embedded', 'error');

  total_bookmarks := COALESCE((current_run.totals->>'total')::integer, 0);
  untracked_error_count := COALESCE((current_run.totals->>'untrackedErrors')::integer, 0);

  IF (terminal_count + untracked_error_count) < total_bookmarks THEN
    RETURN FALSE;
  END IF;

  UPDATE public.pipeline_runs
  SET totals = totals || jsonb_build_object('clusteringEnqueuedAt', NOW())
  WHERE id = current_run.id
    AND status = 'running';

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pipeline_run(p_pipeline_run_id UUID, p_totals JSONB DEFAULT '{}'::jsonb)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_runs
  SET status = 'completed',
      completed_at = NOW(),
      totals = totals || COALESCE(p_totals, '{}'::jsonb)
  WHERE id = p_pipeline_run_id
    AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_user_pipeline_clustering_completed(
  p_user_id UUID,
  p_job_generation BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_runs
  SET totals = totals || jsonb_build_object('clusteringCompletedAt', NOW())
  WHERE user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_user_cancelled(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_pipeline_controls (user_id, is_cancelled, job_generation, updated_at)
  VALUES (p_user_id, TRUE, 0, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET is_cancelled = TRUE,
        updated_at = NOW();

  UPDATE public.pipeline_runs
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, NOW())
  WHERE id = (
      SELECT current_pipeline_run_id
      FROM public.user_pipeline_controls
      WHERE user_id = p_user_id
    )
    AND status = 'running';
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_pipeline_run(p_pipeline_run_id UUID, p_error_summary JSONB DEFAULT '{}'::jsonb)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_runs
  SET status = 'failed',
      completed_at = NOW(),
      error_summary = COALESCE(p_error_summary, '{}'::jsonb)
  WHERE id = p_pipeline_run_id
    AND status = 'running';
END;
$$;
