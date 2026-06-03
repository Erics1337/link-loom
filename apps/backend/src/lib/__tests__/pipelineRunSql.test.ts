import { describe, expect, it } from 'vitest';
import { functionBlockFromSql, readMigrationSql } from './sqlTestUtils';

const pipelineSql = readMigrationSql(
    '20260529015619_add_pipeline_job_generation.sql'
);
const followupSql = readMigrationSql(
    '20260602120000_fix_pipeline_run_readiness.sql'
);
const idempotentErrorsSql = readMigrationSql(
    '20260602123000_idempotent_pipeline_untracked_errors.sql'
);

const runReadinessSql = [pipelineSql, followupSql, idempotentErrorsSql];

describe('pipeline run SQL migrations', () => {
    it('links bookmarks to pipeline runs for run-scoped readiness checks', () => {
        for (const sql of [pipelineSql, followupSql]) {
            expect(sql).toContain('ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES public.pipeline_runs(id)');
            expect(sql).toContain('idx_bookmarks_pipeline_run_status');
        }
    });

    it('claims clustering only after bookmarks for the current run are terminal', () => {
        for (const sql of runReadinessSql) {
            const block = functionBlockFromSql(sql, 'claim_user_pipeline_clustering');
            expect(block).toContain('current_run public.pipeline_runs%ROWTYPE;');
            expect(block).toContain('WHERE id = control_row.current_pipeline_run_id');
            expect(block).toContain('pipeline_run_id = current_run.id');
            expect(block).toContain("status IN ('embedded', 'error')");
            expect(block).toContain("AND status = 'running'");
            expect(block).toContain("current_run.totals->>'ingestCompletedAt' IS NULL");
            expect(block).toContain("current_run.totals->>'clusteringEnqueuedAt' IS NOT NULL");
            expect(block).toContain("current_run.totals->>'total'");
            expect(block).toContain("current_run.totals->>'untrackedErrors'");
            expect(block).toContain('RETURN FALSE;');
            expect(block).not.toContain('WHERE user_id = p_user_id\n      AND status IN');
        }
    });

    it('keeps run telemetry out of user pipeline controls', () => {
        expect(pipelineSql).toContain('current_pipeline_run_id UUID REFERENCES public.pipeline_runs(id)');
        expect(pipelineSql).not.toContain('ADD COLUMN IF NOT EXISTS total_bookmarks INTEGER');
        expect(pipelineSql).not.toContain('ADD COLUMN IF NOT EXISTS untracked_error_count INTEGER');
        expect(pipelineSql).not.toContain('ADD COLUMN IF NOT EXISTS clustering_settings JSONB');
        expect(followupSql).toContain('DROP COLUMN IF EXISTS total_bookmarks');

        for (const sql of runReadinessSql) {
            const untrackedBlock = functionBlockFromSql(sql, 'record_user_pipeline_untracked_error');
            const claimBlock = functionBlockFromSql(sql, 'claim_user_pipeline_clustering');
            expect(untrackedBlock).not.toContain('UPDATE public.user_pipeline_controls');
            expect(claimBlock).not.toContain('SET clustering_enqueued_at');
        }
    });

    it('deduplicates untracked errors by run and error key', () => {
        for (const sql of [pipelineSql, followupSql]) {
            expect(sql).toContain('pipeline_run_untracked_errors');
            const block = functionBlockFromSql(sql, 'record_user_pipeline_untracked_error');
            expect(block).toContain('p_error_key TEXT DEFAULT NULL');
            expect(block).toContain('ON CONFLICT (user_id, job_generation, error_key) DO NOTHING');
            expect(block).toContain('IF inserted_count = 0 THEN');
            expect(block).toContain('RETURN;');
        }
    });

    it('preserves accumulated run telemetry when completing a run', () => {
        for (const sql of [pipelineSql, followupSql]) {
            const block = functionBlockFromSql(sql, 'complete_pipeline_run');
            expect(block).toContain("totals = totals || COALESCE(p_totals, '{}'::jsonb)");
        }
    });
});
