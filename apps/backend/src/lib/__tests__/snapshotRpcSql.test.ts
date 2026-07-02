import { describe, expect, it } from 'vitest';
import { functionBlockFromSql, readMigrationSql } from './sqlTestUtils';

const sql = readMigrationSql('20260606231942_security_hardening.sql');

const functionBlock = (name: string) => functionBlockFromSql(sql, name);

describe('snapshot RPC SQL hardening migration', () => {
    it('checks caller identity before creating or restoring snapshots', () => {
        const createSnapshot = functionBlock('create_structure_snapshot');
        const restoreSnapshot = functionBlock('restore_structure_snapshot');
        const assertUser = functionBlock('assert_snapshot_rpc_user');

        expect(createSnapshot).toContain('PERFORM public.assert_snapshot_rpc_user(p_user_id);');
        expect(restoreSnapshot).toContain('PERFORM public.assert_snapshot_rpc_user(p_user_id);');
        expect(assertUser).toContain("auth.role() = 'service_role'");
        expect(assertUser).toContain('auth.uid() IS NULL OR auth.uid() <> p_user_id');
    });

    it('pins security definer functions to an empty search path with schema-qualified writes', () => {
        for (const name of [
            'assert_snapshot_rpc_user',
            'create_structure_snapshot',
            'restore_structure_snapshot',
        ]) {
            const block = functionBlock(name);
            expect(block).toContain('SECURITY DEFINER');
            expect(block).toContain("SET search_path = ''");
        }

        expect(functionBlock('create_structure_snapshot')).toContain('INSERT INTO public.structure_snapshots');
        expect(functionBlock('restore_structure_snapshot')).toContain('DELETE FROM public.clusters');
    });

    it('revokes broad execution and grants only intended callers', () => {
        expect(sql).toContain(
            'REVOKE ALL ON FUNCTION public.assert_snapshot_rpc_user(UUID) FROM PUBLIC, anon, authenticated, service_role;'
        );
        expect(sql).toContain(
            'REVOKE ALL ON FUNCTION public.create_structure_snapshot(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;'
        );
        expect(sql).toContain(
            'REVOKE ALL ON FUNCTION public.restore_structure_snapshot(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;'
        );
        expect(sql).toContain(
            'GRANT EXECUTE ON FUNCTION public.create_structure_snapshot(UUID, TEXT) TO authenticated, service_role;'
        );
        expect(sql).toContain(
            'GRANT EXECUTE ON FUNCTION public.restore_structure_snapshot(UUID, UUID) TO authenticated, service_role;'
        );
    });
});
