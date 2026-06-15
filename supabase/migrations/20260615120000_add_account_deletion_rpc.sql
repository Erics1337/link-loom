CREATE OR REPLACE FUNCTION public.delete_user_account_data(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_hashes TEXT[];
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'delete_user_account_data requires service_role';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT content_hash), ARRAY[]::TEXT[])
  INTO affected_hashes
  FROM public.bookmarks
  WHERE user_id = p_user_id
    AND content_hash IS NOT NULL;

  DELETE FROM public.users
  WHERE id = p_user_id;

  DELETE FROM public.shared_links s
  WHERE s.id = ANY(affected_hashes)
    AND NOT EXISTS (
      SELECT 1
      FROM public.bookmarks b
      WHERE b.content_hash = s.id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account_data(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account_data(UUID) TO service_role;

DROP POLICY IF EXISTS "Authenticated users can read shared link cache" ON public.shared_links;
REVOKE ALL ON TABLE public.shared_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shared_links TO service_role;
