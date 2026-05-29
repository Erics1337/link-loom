ALTER TABLE public.user_pipeline_controls
ADD COLUMN IF NOT EXISTS job_generation BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_user_pipeline_controls_cancelled
ON public.user_pipeline_controls (user_id, is_cancelled, job_generation);
