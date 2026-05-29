CREATE OR REPLACE FUNCTION public.assert_snapshot_rpc_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'Snapshot user does not match authenticated user';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_structure_snapshot(p_user_id UUID, p_snapshot_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_snapshot_id UUID;
BEGIN
    PERFORM public.assert_snapshot_rpc_user(p_user_id);

    INSERT INTO public.structure_snapshots (user_id, name)
    VALUES (p_user_id, p_snapshot_name)
    RETURNING id INTO v_snapshot_id;

    CREATE TEMP TABLE tmp_cluster_map (
        old_id UUID,
        new_id UUID
    ) ON COMMIT DROP;

    WITH inserted AS (
        INSERT INTO public.snapshot_clusters (snapshot_id, original_cluster_id, name, parent_id)
        SELECT v_snapshot_id, id, name, NULL
        FROM public.clusters
        WHERE user_id = p_user_id
        RETURNING id AS new_id, original_cluster_id AS old_id
    )
    INSERT INTO pg_temp.tmp_cluster_map (old_id, new_id)
    SELECT old_id, new_id FROM inserted;

    UPDATE public.snapshot_clusters sc
    SET parent_id = parent_map.new_id
    FROM public.clusters c
    JOIN pg_temp.tmp_cluster_map parent_map ON parent_map.old_id = c.parent_id
    WHERE sc.snapshot_id = v_snapshot_id
      AND sc.original_cluster_id = c.id;

    INSERT INTO public.snapshot_assignments (snapshot_cluster_id, bookmark_id)
    SELECT map.new_id, ca.bookmark_id
    FROM public.cluster_assignments ca
    JOIN public.clusters c ON c.id = ca.cluster_id
    JOIN pg_temp.tmp_cluster_map map ON map.old_id = c.id
    JOIN public.bookmarks b ON b.id = ca.bookmark_id
    WHERE c.user_id = p_user_id
      AND b.user_id = p_user_id;

    RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_structure_snapshot(p_user_id UUID, p_snapshot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.assert_snapshot_rpc_user(p_user_id);

    IF NOT EXISTS (
        SELECT 1
        FROM public.structure_snapshots
        WHERE id = p_snapshot_id
          AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Snapshot not found or does not belong to user';
    END IF;

    DELETE FROM public.clusters WHERE user_id = p_user_id;

    INSERT INTO public.clusters (id, user_id, name, parent_id)
    SELECT original_cluster_id, p_user_id, name, NULL
    FROM public.snapshot_clusters
    WHERE snapshot_id = p_snapshot_id;

    UPDATE public.clusters cur
    SET parent_id = parent_sc.original_cluster_id
    FROM public.snapshot_clusters sc
    JOIN public.snapshot_clusters parent_sc ON parent_sc.id = sc.parent_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND cur.user_id = p_user_id
      AND cur.id = sc.original_cluster_id;

    INSERT INTO public.cluster_assignments (cluster_id, bookmark_id)
    SELECT sc.original_cluster_id, sa.bookmark_id
    FROM public.snapshot_assignments sa
    JOIN public.snapshot_clusters sc ON sc.id = sa.snapshot_cluster_id
    JOIN public.bookmarks b ON b.id = sa.bookmark_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND b.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_snapshot_rpc_user(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_structure_snapshot(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_structure_snapshot(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_structure_snapshot(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_structure_snapshot(UUID, UUID) TO authenticated, service_role;
