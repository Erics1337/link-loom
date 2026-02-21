-- Function to enforce the 500 bookmark limit for free tier users
CREATE OR REPLACE FUNCTION enforce_bookmark_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_premium BOOLEAN;
  v_bookmark_count INTEGER;
BEGIN
  -- We only care about inserts
  IF TG_OP = 'INSERT' THEN
    -- Get user premium status
    SELECT is_premium INTO v_is_premium 
    FROM public.users 
    WHERE id = NEW.user_id;

    -- If user is not premium or is_premium is null, check count
    IF v_is_premium IS NOT TRUE THEN
      SELECT count(*) INTO v_bookmark_count 
      FROM public.bookmarks 
      WHERE user_id = NEW.user_id;

      -- If they already have 500 or more bookmarks, prevent insertion
      IF v_bookmark_count >= 500 THEN
        RAISE EXCEPTION 'Free tier limit reached. Please upgrade to premium to add more than 500 bookmarks.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the before insert trigger on the bookmarks table
DROP TRIGGER IF EXISTS trg_enforce_bookmark_limit ON public.bookmarks;

CREATE TRIGGER trg_enforce_bookmark_limit
  BEFORE INSERT ON public.bookmarks
  FOR EACH ROW
  EXECUTE FUNCTION enforce_bookmark_limit();
