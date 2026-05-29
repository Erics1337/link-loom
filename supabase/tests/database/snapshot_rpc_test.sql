BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_structure_snapshot'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ),
  'create_structure_snapshot is SECURITY DEFINER with empty search_path'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'restore_structure_snapshot'
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ),
  'restore_structure_snapshot is SECURITY DEFINER with empty search_path'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.create_structure_snapshot(uuid,text)', 'EXECUTE'),
  'authenticated can execute create_structure_snapshot'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.restore_structure_snapshot(uuid,uuid)', 'EXECUTE'),
  'authenticated can execute restore_structure_snapshot'
);

SELECT ok(
  has_function_privilege('service_role', 'public.create_structure_snapshot(uuid,text)', 'EXECUTE'),
  'service_role can execute create_structure_snapshot'
);

SELECT ok(
  has_function_privilege('service_role', 'public.restore_structure_snapshot(uuid,uuid)', 'EXECUTE'),
  'service_role can execute restore_structure_snapshot'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.create_structure_snapshot(uuid,text)', 'EXECUTE'),
  'anon cannot execute create_structure_snapshot'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.restore_structure_snapshot(uuid,uuid)', 'EXECUTE'),
  'anon cannot execute restore_structure_snapshot'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE n.nspname = 'public'
      AND p.proname = 'create_structure_snapshot'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'public cannot execute create_structure_snapshot'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE n.nspname = 'public'
      AND p.proname = 'restore_structure_snapshot'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'public cannot execute restore_structure_snapshot'
);

INSERT INTO public.users (id, email)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'snapshot-one@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'snapshot-two@example.test');

INSERT INTO public.bookmarks (id, user_id, chrome_id, url, title, status)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'chrome-one',
  'https://example.com/one',
  'One',
  'embedded'
);

INSERT INTO public.clusters (id, user_id, name)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'One Cluster'
);

INSERT INTO public.cluster_assignments (cluster_id, bookmark_id)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

CREATE TEMP TABLE snapshot_rpc_results AS
SELECT public.create_structure_snapshot(
  '00000000-0000-4000-8000-000000000001',
  'Own Snapshot'
) AS own_snapshot_id;

SELECT ok(
  (SELECT own_snapshot_id IS NOT NULL FROM snapshot_rpc_results),
  'authenticated user can create own snapshot'
);

SELECT lives_ok(
  format(
    'SELECT public.restore_structure_snapshot(%L::uuid, %L::uuid)',
    '00000000-0000-4000-8000-000000000001',
    (SELECT own_snapshot_id::text FROM snapshot_rpc_results)
  ),
  'authenticated user can restore own snapshot'
);

SELECT throws_like(
  $$
    SELECT public.create_structure_snapshot(
      '00000000-0000-4000-8000-000000000002',
      'Wrong User Snapshot'
    )
  $$,
  '%Snapshot user does not match authenticated user%',
  'authenticated user cannot create another user snapshot'
);

SELECT throws_like(
  format(
    'SELECT public.restore_structure_snapshot(%L::uuid, %L::uuid)',
    '00000000-0000-4000-8000-000000000002',
    (SELECT own_snapshot_id::text FROM snapshot_rpc_results)
  ),
  '%Snapshot user does not match authenticated user%',
  'authenticated user cannot restore another user snapshot'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

CREATE TEMP TABLE service_snapshot_rpc_results AS
SELECT public.create_structure_snapshot(
    '00000000-0000-4000-8000-000000000001',
    'Service Snapshot'
  ) AS service_snapshot_id;

SELECT ok(
  (SELECT service_snapshot_id IS NOT NULL FROM service_snapshot_rpc_results),
  'service_role can create snapshot'
);

SELECT lives_ok(
  format(
    'SELECT public.restore_structure_snapshot(%L::uuid, %L::uuid)',
    '00000000-0000-4000-8000-000000000001',
    (SELECT service_snapshot_id::text FROM service_snapshot_rpc_results)
  ),
  'service_role can restore snapshot'
);

SELECT * FROM finish();

ROLLBACK;
