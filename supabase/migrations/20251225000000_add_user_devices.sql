-- Create user_devices table
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);

-- Enable RLS
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own devices"
  ON user_devices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own devices"
  ON user_devices FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can register their own device"
  ON user_devices FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    (
      SELECT count(*)
      FROM user_devices
      WHERE user_id = auth.uid()
    ) < 3 -- Limit to 3 devices
  );

-- Update last_seen_at on login (optional, but good for tracking)
-- We can do this via an ON CONFLICT check in the client or a trigger, 
-- but client-side upsert with ON CONFLICT DO UPDATE is easier.
