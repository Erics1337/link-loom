import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pipelineMigrationPath = resolve(
    __dirname,
    '../../../../../supabase/migrations/20260529015619_add_pipeline_job_generation.sql'
);

const followupMigrationPath = resolve(
    __dirname,
    '../../../../../supabase/migrations/20260602120000_fix_pipeline_run_readiness.sql'
);

const pipelineSql = readFileSync(pipelineMigrationPath, 'utf8');
const followupSql = readFileSync(followupMigrationPath, 'utf8');

const functionBlock = (sql: string, name: string) => {
    const pattern = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        'i'
    );
    const match = sql.match(pattern);
    if (!match) {
        throw new Error(`Could not find function ${name}.`);
    }
    return match[0];
};

describe('pipeline run SQL migrations', () => {
    it('links bookmarks to pipeline runs for run-scoped readiness checks', () => {
        for (const sql of [pipelineSql, followupSql]) {
            expect(sql).toContain('ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES public.pipeline_runs(id)');
            expect(sql).toContain('idx_bookmarks_pipeline_run_status');
        }
    });

    it('claims clustering only after bookmarks for the current run are terminal', () => {
        for (const sql of [pipelineSql, followupSql]) {
            const block = functionBlock(sql, 'claim_user_pipeline_clustering');
            expect(block).toContain('current_run_id UUID;');
            expect(block).toContain('pipeline_run_id = current_run_id');
            expect(block).toContain("status IN ('embedded', 'error')");
            expect(block).toContain("AND status = 'running'");
            expect(block).not.toContain('total_bookmarks <= 0');
            expect(block).toContain('IF current_run_id IS NULL THEN');
            expect(block).toContain('RETURN FALSE;');
            expect(block).not.toContain('WHERE user_id = p_user_id\n      AND status IN');
        }
    });

    it('deduplicates untracked errors by run and error key', () => {
        for (const sql of [pipelineSql, followupSql]) {
            expect(sql).toContain('pipeline_run_untracked_errors');
            const block = functionBlock(sql, 'record_user_pipeline_untracked_error');
            expect(block).toContain('p_error_key TEXT DEFAULT NULL');
            expect(block).toContain('ON CONFLICT (user_id, job_generation, error_key) DO NOTHING');
            expect(block).toContain('IF inserted_count = 0 THEN');
            expect(block).toContain('RETURN;');
        }
    });

    it('preserves accumulated run telemetry when completing a run', () => {
        for (const sql of [pipelineSql, followupSql]) {
            const block = functionBlock(sql, 'complete_pipeline_run');
            expect(block).toContain("totals = totals || COALESCE(p_totals, '{}'::jsonb)");
        }
    });
});
