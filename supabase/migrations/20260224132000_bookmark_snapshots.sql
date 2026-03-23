-- 1. Create Snapshot Tables
CREATE TABLE IF NOT EXISTS structure_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS snapshot_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES structure_snapshots(id) ON DELETE CASCADE,
  original_cluster_id UUID NOT NULL,
  name TEXT,
  parent_id UUID REFERENCES snapshot_clusters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_assignments (
  snapshot_cluster_id UUID REFERENCES snapshot_clusters(id) ON DELETE CASCADE,
  bookmark_id UUID REFERENCES bookmarks(id) ON DELETE CASCADE,
  PRIMARY KEY (snapshot_cluster_id, bookmark_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_structure_snapshots_user_id ON structure_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_clusters_snapshot_id ON snapshot_clusters(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_clusters_parent_id ON snapshot_clusters(parent_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_assignments_bookmark_id ON snapshot_assignments(bookmark_id);

-- 2. Create RPCs for Creating and Restoring Snapshots
-- These run atomically on the DB server so we don't have to ferry megabytes of bookmark relationships
-- over HTTP requests from the client.

CREATE OR REPLACE FUNCTION create_structure_snapshot(p_user_id UUID, p_snapshot_name TEXT) 
RETURNS UUID AS $$
DECLARE
    v_snapshot_id UUID;
BEGIN
    -- 1. Create the snapshot record
    INSERT INTO structure_snapshots (user_id, name)
    VALUES (p_user_id, p_snapshot_name)
    RETURNING id INTO v_snapshot_id;

    -- 2. Copy Clusters to Snapshot Clusters
    -- We need to map the old cluster IDs to the new snapshot cluster IDs while preserving the hierarchy.
    -- Since hierarchical inserts require knowing the new parent IDs, we use a CTE (WITH RECURSIVE) 
    -- or map them sequentially. However, in Postgres, we can do this safely by first creating all new nodes, 
    -- then updating their parent references.

    -- Temporary table to hold the mapping
    CREATE TEMP TABLE tmp_cluster_map (
        old_id UUID,
        new_id UUID
    ) ON COMMIT DROP;

    -- Insert all clusters and store the mapping
    -- We generate new UUIDs on the fly by inserting and returning
    WITH inserted AS (
        INSERT INTO snapshot_clusters (snapshot_id, original_cluster_id, name, parent_id)
        SELECT v_snapshot_id, id, name, NULL -- temporarily set parent_id to NULL
        FROM clusters
        WHERE user_id = p_user_id
        RETURNING id AS new_id, original_cluster_id AS old_id
    )
    INSERT INTO tmp_cluster_map (old_id, new_id)
    SELECT old_id, new_id FROM inserted;

    -- Update parent_ids in snapshot_clusters using the mapping
    UPDATE snapshot_clusters sc
    SET parent_id = parent_map.new_id
    FROM clusters c
    JOIN tmp_cluster_map parent_map ON parent_map.old_id = c.parent_id
    WHERE sc.snapshot_id = v_snapshot_id
      AND sc.original_cluster_id = c.id;

    -- 3. Copy Assignments
    INSERT INTO snapshot_assignments (snapshot_cluster_id, bookmark_id)
    SELECT map.new_id, ca.bookmark_id
    FROM cluster_assignments ca
    JOIN clusters c ON c.id = ca.cluster_id
    JOIN tmp_cluster_map map ON map.old_id = c.id
    WHERE c.user_id = p_user_id;

    RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION restore_structure_snapshot(p_user_id UUID, p_snapshot_id UUID) 
RETURNS VOID AS $$
BEGIN
    -- Verify the snapshot belongs to the user
    IF NOT EXISTS (SELECT 1 FROM structure_snapshots WHERE id = p_snapshot_id AND user_id = p_user_id) THEN
        RAISE EXCEPTION 'Snapshot not found or does not belong to user';
    END IF;

    -- 1. Delete current clusters (cascades to cluster_assignments)
    DELETE FROM clusters WHERE user_id = p_user_id;

    -- 2. Restore Clusters from Snapshot
    CREATE TEMP TABLE tmp_restore_map (
        old_snapshot_cluster_id UUID,
        new_cluster_id UUID
    ) ON COMMIT DROP;

    WITH inserted AS (
        INSERT INTO clusters (id, user_id, name, parent_id)
        SELECT original_cluster_id, p_user_id, name, NULL -- temporarily NULL
        FROM snapshot_clusters
        WHERE snapshot_id = p_snapshot_id
        RETURNING id AS new_cluster_id, id AS old_snapshot_cluster_id_proxy
    )
    -- We used the original_cluster_id as the ID for the new cluster to keep the UUIDs deterministic
    -- So old_snapshot_cluster_id_proxy is actually original_cluster_id. 
    -- Let's build the map differently to be completely robust.
    -- To perfectly preserve the exact UUIDs of the original clusters, we insert them exactly as they were.
    -- Note that if original_cluster_id was already present (e.g., from another source) we might have a collision,
    -- but we just deleted ALL user clusters above, so those UUIDs are free again.
    
    -- Actually, if we just insert using the `original_cluster_id` from `snapshot_clusters` for the `id` of `clusters`,
    -- we can easily map the parent_ids using the same static UUIDs!
    
    INSERT INTO clusters (id, user_id, name, parent_id)
    SELECT 
        original_cluster_id, 
        p_user_id, 
        name, 
        NULL
    FROM snapshot_clusters sc
    WHERE snapshot_id = p_snapshot_id;

    -- Now update the parent pointers
    -- We look up what the original parent's original_cluster_id was!
    UPDATE clusters cur
    SET parent_id = parent_sc.original_cluster_id
    FROM snapshot_clusters sc
    JOIN snapshot_clusters parent_sc ON parent_sc.id = sc.parent_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND cur.user_id = p_user_id
      AND cur.id = sc.original_cluster_id;

    -- 3. Restore Assignments
    -- IMPORTANT: Only insert assignments if the bookmark still exists!
    INSERT INTO cluster_assignments (cluster_id, bookmark_id)
    SELECT sc.original_cluster_id, sa.bookmark_id
    FROM snapshot_assignments sa
    JOIN snapshot_clusters sc ON sc.id = sa.snapshot_cluster_id
    JOIN bookmarks b ON b.id = sa.bookmark_id
    WHERE sc.snapshot_id = p_snapshot_id
      AND b.user_id = p_user_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
