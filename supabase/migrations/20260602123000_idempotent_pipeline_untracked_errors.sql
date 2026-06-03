CREATE TABLE IF NOT EXISTS public.pipeline_run_untracked_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_generation BIGINT NOT NULL,
  error_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_generation, error_key)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_untracked_errors_user_generation
ON public.pipeline_run_untracked_errors (user_id, job_generation);

ALTER TABLE public.pipeline_run_untracked_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pipeline_run_untracked_errors FROM anon, authenticated;

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

  UPDATE public.user_pipeline_controls
  SET untracked_error_count = untracked_error_count + 1,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND job_generation = p_job_generation;

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
  current_run_id UUID;
  terminal_count INTEGER;
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
     OR control_row.ingest_completed_at IS NULL
     OR control_row.clustering_enqueued_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  SELECT id
  INTO current_run_id
  FROM public.pipeline_runs
  WHERE user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running';

  IF current_run_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*)
  INTO terminal_count
  FROM public.bookmarks
  WHERE user_id = p_user_id
    AND pipeline_run_id = current_run_id
    AND status IN ('embedded', 'error');

  IF (terminal_count + control_row.untracked_error_count) < control_row.total_bookmarks THEN
    RETURN FALSE;
  END IF;

  UPDATE public.user_pipeline_controls
  SET clustering_enqueued_at = NOW(),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND job_generation = p_job_generation;

  UPDATE public.pipeline_runs
  SET totals = totals || jsonb_build_object('clusteringEnqueuedAt', NOW())
  WHERE user_id = p_user_id
    AND generation = p_job_generation
    AND status = 'running';

  RETURN TRUE;
END;
$$;
