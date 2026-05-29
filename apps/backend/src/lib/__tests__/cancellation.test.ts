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
    updated_at: string;
};

const controls = new Map<string, ControlRow>();
let selectError: unknown = null;

vi.mock('../../db', () => ({
    supabase: {
        from: vi.fn((table: string) => {
            if (table !== 'user_pipeline_controls') {
                throw new Error(`Unexpected table ${table}`);
            }

            let userId = '';
            return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn((_column: string, value: string) => {
                    userId = value;
                    return {
                        maybeSingle: vi.fn(async () => ({
                            data: controls.get(userId) ?? null,
                            error: selectError,
                        })),
                    };
                }),
                upsert: vi.fn(async (row: ControlRow) => {
                    controls.set(row.user_id, row);
                    return { data: null, error: null };
                }),
            };
        }),
    },
}));

describe('durable cancellation controls', () => {
    beforeEach(() => {
        controls.clear();
        selectError = null;
    });

    it('starts a new pipeline generation and clears cancellation', async () => {
        controls.set('user-1', {
            user_id: 'user-1',
            is_cancelled: true,
            job_generation: 3,
            updated_at: '2026-01-01T00:00:00.000Z',
        });

        const generation = await beginUserPipelineRun('user-1');

        expect(generation).toBe(4);
        expect(controls.get('user-1')).toMatchObject({
            user_id: 'user-1',
            is_cancelled: false,
            job_generation: 4,
        });
    });

    it('treats older queued work as cancelled after a new generation starts', async () => {
        await beginUserPipelineRun('user-1');
        const currentGeneration = await beginUserPipelineRun('user-1');

        expect(currentGeneration).toBe(2);
        expect(await isUserCancelled('user-1', 1)).toBe(true);
        expect(await isUserCancelled('user-1', 2)).toBe(false);
    });

    it('marks the current generation as cancelled without advancing it', async () => {
        const generation = await beginUserPipelineRun('user-1');

        await markUserCancelled('user-1');

        expect(controls.get('user-1')).toMatchObject({
            is_cancelled: true,
            job_generation: generation,
        });
        expect(await isUserCancelled('user-1', generation)).toBe(true);
    });

    it('fails closed when cancellation state cannot be read', async () => {
        selectError = { message: 'database unavailable' };

        expect(await isUserCancelled('user-1', 1)).toBe(true);
    });
});
