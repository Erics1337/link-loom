CREATE OR REPLACE FUNCTION assert_snapshot_rpc_user(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'Snapshot user does not match authenticated user';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_structure_snapshot(p_user_id UUID, p_snapshot_name TEXT)
RETURNS UUID AS $$
DECLARE
    v_snapshot_id UUID;
BEGIN
    PERFORM assert_snapshot_rpc_user(p_user_id);

    INSERT INTO structure_snapshots (user_id, name)
    VALUES (p_user_id, p_snapshot_name)
    RETURNING id INTO v_snapshot_id;

    CREATE TEMP TABLE tmp_cluster_map (
        old_id UUID,
        new_id UUID
    ) ON COMMIT DROP;

    WITH inserted AS (
        INSERT INTO snapshot_clusters (snapshot_id, original_cluster_id, name, parent_id)
        SELECT v_snapshot_id, id, name, NULL
        FROM clusters
        WHERE user_id = p_user_id
        RETURNING id AS new_id, original_cluster_id AS old_id
    )
    INSERT INTO tmp_cluster_map (old_id, new_id)
    SELECT old_id, new_id FROM inserted;

    UPDATE snapshot_clusters sc
    SET parent_id = parent_map.new_id
    FROM clusters c
    JOIN tmp_cluster_map parent_map ON parent_map.old_id = c.parent_id
    WHERE sc.snapshot_id = v_snapshot_id
      AND sc.original_cluster_id = c.id;

    INSERT INTO snapshot_assignments (snapshot_cluster_id, bookmark_id)
    SELECT map.new_id, ca.bookmark_id
    FROM cluster_assignments ca
    JOIN clusters c ON c.id = ca.cluster_id
    JOIN tmp_cluster_map map ON map.old_id = c.id
    JOIN bookmarks b ON b.id = ca.bookmark_id
    WHERE c.user_id = p_user_id
      AND b.user_id = p_user_id;

    RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION restore_structure_snapshot(p_user_id UUID, p_snapshot_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM assert_snapshot_rpc_user(p_user_id);

    IF NOT EXISTS (
        SELECT 1
        FROM structure_snapshots
        WHERE id = p_snapshot_id
          AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Snapshot not found or does not belong to user';
    END IF;

    DELETE FROM clusters WHERE user_id = p_user_id;

    INSERT INTO clusters (id, user_id, name, parent_id)
    SELECT original_cluster_id, p_user_id, name, NULL
    FROM snapshot_clusters
    WHERE snapshot_id = p_snapshot_id;

    UPDATE clusters cur
    SET parent_id = parent_sc.original_cluster_id
    FROM snapshot_clusters sc
    JOIN snapshot_clusters parent_sc ON parent_sc.id = sc.parent_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND cur.user_id = p_user_id
      AND cur.id = sc.original_cluster_id;

    INSERT INTO cluster_assignments (cluster_id, bookmark_id)
    SELECT sc.original_cluster_id, sa.bookmark_id
    FROM snapshot_assignments sa
    JOIN snapshot_clusters sc ON sc.id = sa.snapshot_cluster_id
    JOIN bookmarks b ON b.id = sa.bookmark_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND b.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION assert_snapshot_rpc_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_structure_snapshot(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_structure_snapshot(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_structure_snapshot(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION restore_structure_snapshot(UUID, UUID) TO authenticated, service_role;
