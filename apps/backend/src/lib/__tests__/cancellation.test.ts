import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    beginUserPipelineRun,
    isUserCancelled,
    markUserCancelled,
} from '../cancellation';

type ControlRow = {
    user_id: string;
    is_cancelled: boolean;
    job_generation: number;
    current_pipeline_run_id: string | null;
    updated_at: string;
};

type RunRow = {
    id: string;
    user_id: string;
    generation: number;
    status: 'running' | 'cancelled' | 'completed' | 'failed';
};

const controls = new Map<string, ControlRow>();
const runs = new Map<string, RunRow>();
let selectError: unknown = null;

vi.mock('../../db', () => ({
    supabase: {
        rpc: vi.fn(async (fn: string, args: { p_user_id: string }) => {
            const userId = args.p_user_id;
            if (fn === 'begin_user_pipeline_run') {
                const current = controls.get(userId);
                const nextGeneration = (current?.job_generation ?? 0) + 1;
                const run = {
                    id: `run-${nextGeneration}`,
                    user_id: userId,
                    generation: nextGeneration,
                    status: 'running' as const,
                };
                runs.set(run.id, run);
                controls.set(userId, {
                    user_id: userId,
                    is_cancelled: false,
                    job_generation: nextGeneration,
                    current_pipeline_run_id: run.id,
                    updated_at: new Date().toISOString(),
                });
                return { data: { id: run.id, generation: nextGeneration }, error: null };
            }

            if (fn === 'mark_user_cancelled') {
                const current = controls.get(userId);
                controls.set(userId, {
                    user_id: userId,
                    is_cancelled: true,
                    job_generation: current?.job_generation ?? 0,
                    current_pipeline_run_id: current?.current_pipeline_run_id ?? null,
                    updated_at: new Date().toISOString(),
                });
                for (const run of Array.from(runs.values())) {
                    if (run.user_id === userId && run.generation === (current?.job_generation ?? 0)) {
                        run.status = 'cancelled';
                    }
                }
                return { data: null, error: null };
            }

            throw new Error(`Unexpected rpc ${fn}`);
        }),
        from: vi.fn((table: string) => {
            if (!['user_pipeline_controls', 'pipeline_runs'].includes(table)) {
                throw new Error(`Unexpected table ${table}`);
            }

            let userId = '';
            let runId = '';
            const chain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn((_column: string, value: string) => {
                    if (_column === 'user_id') userId = value;
                    if (_column === 'id') runId = value;
                    return chain;
                }),
                maybeSingle: vi.fn(async () => ({
                    data: table === 'user_pipeline_controls'
                        ? controls.get(userId) ?? null
                        : Array.from(runs.values()).find(run => run.id === runId && run.user_id === userId) ?? null,
                    error: selectError,
                })),
            };
            return chain;
        }),
    },
}));

describe('durable cancellation controls', () => {
    beforeEach(() => {
        controls.clear();
        runs.clear();
        selectError = null;
    });

    it('starts a new pipeline generation and clears cancellation', async () => {
        controls.set('user-1', {
            user_id: 'user-1',
            is_cancelled: true,
            job_generation: 3,
            current_pipeline_run_id: 'run-3',
            updated_at: '2026-01-01T00:00:00.000Z',
        });

        const run = await beginUserPipelineRun('user-1');

        expect(run).toMatchObject({ id: 'run-4', generation: 4 });
        expect(controls.get('user-1')).toMatchObject({
            user_id: 'user-1',
            is_cancelled: false,
            job_generation: 4,
            current_pipeline_run_id: 'run-4',
        });
    });

    it('treats older queued work as cancelled after a new generation starts', async () => {
        const staleRun = await beginUserPipelineRun('user-1');
        const currentRun = await beginUserPipelineRun('user-1');

        expect(currentRun.generation).toBe(2);
        expect(await isUserCancelled('user-1', 1)).toBe(true);
        expect(await isUserCancelled('user-1', staleRun.generation, staleRun.id)).toBe(true);
        expect(await isUserCancelled('user-1', 2)).toBe(false);
        expect(await isUserCancelled('user-1', 2, currentRun.id)).toBe(false);
    });

    it('marks the current generation as cancelled without advancing it', async () => {
        const run = await beginUserPipelineRun('user-1');

        await markUserCancelled('user-1');

        expect(controls.get('user-1')).toMatchObject({
            is_cancelled: true,
            job_generation: run.generation,
            current_pipeline_run_id: run.id,
        });
        expect(await isUserCancelled('user-1', run.generation, run.id)).toBe(true);
    });

    it('fails closed when cancellation state cannot be read', async () => {
        selectError = { message: 'database unavailable' };

        expect(await isUserCancelled('user-1', 1)).toBe(true);
    });
});
