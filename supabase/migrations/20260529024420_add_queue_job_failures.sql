CREATE TABLE IF NOT EXISTS public.queue_job_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name TEXT NOT NULL CHECK (queue_name IN ('ingest', 'enrichment', 'embedding', 'clustering')),
  job_id TEXT NOT NULL,
  job_name TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  bookmark_id UUID REFERENCES public.bookmarks(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  receive_count INTEGER NOT NULL CHECK (receive_count > 0),
  error_message TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_name, job_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_job_failures_user_failed_at
ON public.queue_job_failures (user_id, failed_at DESC);

ALTER TABLE public.queue_job_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.queue_job_failures FROM anon, authenticated;
GRANT SELECT ON public.queue_job_failures TO authenticated;

DROP POLICY IF EXISTS "Users can read their own queue job failures" ON public.queue_job_failures;
CREATE POLICY "Users can read their own queue job failures"
ON public.queue_job_failures
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
