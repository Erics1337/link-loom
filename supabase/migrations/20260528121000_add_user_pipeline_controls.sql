CREATE TABLE IF NOT EXISTS user_pipeline_controls (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_pipeline_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own pipeline controls" ON public.user_pipeline_controls;
CREATE POLICY "Users can read their own pipeline controls"
ON public.user_pipeline_controls
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
