CREATE TABLE IF NOT EXISTS public.queue_job_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name TEXT NOT NULL CHECK (queue_name IN ('ingest', 'enrichment', 'embedding', 'clustering')),
  job_id TEXT NOT NULL,
  job_name TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  pipeline_run_id UUID REFERENCES public.pipeline_runs(id) ON DELETE SET NULL,
  bookmark_id UUID REFERENCES public.bookmarks(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  receive_count INTEGER NOT NULL CHECK (receive_count > 0),
  error_message_sanitized TEXT,
  error_message_hash TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_name, job_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'queue_job_failures'
      AND column_name = 'error_message'
  ) THEN
    ALTER TABLE public.queue_job_failures
      RENAME COLUMN error_message TO error_message_sanitized;
  END IF;
END $$;

ALTER TABLE public.queue_job_failures
  ADD COLUMN IF NOT EXISTS error_message_hash TEXT;

UPDATE public.queue_job_failures
SET error_message_sanitized = left(error_message_sanitized, 1000)
WHERE error_message_sanitized IS NOT NULL
  AND char_length(error_message_sanitized) > 1000;

ALTER TABLE public.queue_job_failures
  DROP CONSTRAINT IF EXISTS queue_job_failures_error_message_sanitized_length_check;

ALTER TABLE public.queue_job_failures
  ADD CONSTRAINT queue_job_failures_error_message_sanitized_length_check
  CHECK (error_message_sanitized IS NULL OR char_length(error_message_sanitized) <= 1000);

ALTER TABLE public.queue_job_failures
  DROP CONSTRAINT IF EXISTS queue_job_failures_error_message_hash_format_check;

ALTER TABLE public.queue_job_failures
  ADD CONSTRAINT queue_job_failures_error_message_hash_format_check
  CHECK (error_message_hash IS NULL OR error_message_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_queue_job_failures_user_failed_at
ON public.queue_job_failures (user_id, failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_queue_job_failures_pipeline_run
ON public.queue_job_failures (pipeline_run_id);

ALTER TABLE public.queue_job_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.queue_job_failures FROM anon, authenticated;
GRANT SELECT ON public.queue_job_failures TO authenticated;

DROP POLICY IF EXISTS "Users can read their own queue job failures" ON public.queue_job_failures;
CREATE POLICY "Users can read their own queue job failures"
ON public.queue_job_failures
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

COMMENT ON COLUMN public.queue_job_failures.error_message_sanitized IS
  'Scrubbed and truncated failure text only; remove tokens, IDs, secrets, and other PII before insert.';

COMMENT ON COLUMN public.queue_job_failures.error_message_hash IS
  'SHA-256 hex fingerprint of the raw failure message for grouping duplicate failures without storing sensitive text.';
