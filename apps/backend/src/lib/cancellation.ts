import { supabase } from '../db';

type PipelineControlRow = {
    is_cancelled: boolean;
    job_generation: number;
    current_pipeline_run_id: string | null;
};

export type PipelineRunRef = {
    id: string;
    generation: number;
};

export type PipelineControlCache = Map<string, PipelineControlRow | null>;

const readPipelineControl = async (userId: string): Promise<PipelineControlRow | null> => {
    const { data, error } = await supabase
        .from('user_pipeline_controls')
        .select('is_cancelled, job_generation, current_pipeline_run_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error(`[CANCEL] Failed to load cancellation state for user ${userId}`, error);
        throw error;
    }

    if (!data) return null;

    return {
        is_cancelled: Boolean(data.is_cancelled),
        job_generation: Number(data.job_generation ?? 0),
        current_pipeline_run_id: data.current_pipeline_run_id == null ? null : String(data.current_pipeline_run_id),
    };
};

export const beginUserPipelineRun = async (userId: string) => {
    const { data, error } = await supabase.rpc('begin_user_pipeline_run', {
        p_user_id: userId,
    });

    if (error) {
        console.error(`[CANCEL] Failed to begin pipeline run for user ${userId}`, error);
        throw error;
    }

    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const candidate = data as { id?: unknown; generation?: unknown };
        return {
            id: String(candidate.id ?? ''),
            generation: Number(candidate.generation ?? 0),
        };
    }

    return {
        id: '',
        generation: Number(data ?? 0),
    };
};

export const clearUserCancelled = async (userId: string) => {
    return beginUserPipelineRun(userId);
};

export const markUserCancelled = async (userId: string) => {
    const { error } = await supabase
        .rpc('mark_user_cancelled', {
            p_user_id: userId,
        });

    if (error) {
        console.error(`[CANCEL] Failed to mark user ${userId} as cancelled`, error);
        throw error;
    }
};

export const isUserCancelled = async (
    userId: string,
    jobGeneration?: number,
    pipelineRunId?: string,
    cache?: PipelineControlCache
) => {
    try {
        let current = cache?.get(userId);
        if (!cache?.has(userId)) {
            current = await readPipelineControl(userId);
            cache?.set(userId, current);
        }

        if (!current) return false;

        if (pipelineRunId) {
            if (current.current_pipeline_run_id !== pipelineRunId) {
                console.log(
                    `[CANCEL] Stale pipeline run for user ${userId}: run=${pipelineRunId}, current=${current.current_pipeline_run_id ?? 'none'}`
                );
                return true;
            }

            const { data: run, error: runError } = await supabase
                .from('pipeline_runs')
                .select('generation, status')
                .eq('id', pipelineRunId)
                .eq('user_id', userId)
                .maybeSingle();

            if (runError) {
                console.error(`[CANCEL] Failed to load pipeline run ${pipelineRunId}`, runError);
                throw runError;
            }

            if (!run) {
                console.log(`[CANCEL] Missing pipeline run ${pipelineRunId} for user ${userId}`);
                return true;
            }

            if (Number(run.generation ?? 0) !== current.job_generation) {
                console.log(
                    `[CANCEL] Stale pipeline run for user ${userId}: run=${run.generation}, current=${current.job_generation}`
                );
                return true;
            }

            return run.status !== 'running';
        }

        if (typeof jobGeneration === 'number' && current.job_generation !== jobGeneration) {
            console.log(
                `[CANCEL] Stale job generation for user ${userId}: job=${jobGeneration}, current=${current.job_generation}`
            );
            return true;
        }

        return current.is_cancelled;
    } catch {
        return true;
    }
};

export const completePipelineRun = async (pipelineRunId: string, totals: Record<string, unknown> = {}) => {
    if (!pipelineRunId) return;

    const { error } = await supabase.rpc('complete_pipeline_run', {
        p_pipeline_run_id: pipelineRunId,
        p_totals: totals,
    });

    if (error) {
        console.error(`[PIPELINE] Failed to complete pipeline run ${pipelineRunId}`, error);
        throw error;
    }
};

export const failPipelineRun = async (pipelineRunId: string, errorSummary: Record<string, unknown> = {}) => {
    if (!pipelineRunId) return;

    const { error } = await supabase.rpc('fail_pipeline_run', {
        p_pipeline_run_id: pipelineRunId,
        p_error_summary: errorSummary,
    });

    if (error) {
        console.error(`[PIPELINE] Failed to mark pipeline run ${pipelineRunId} failed`, error);
        throw error;
    }
};
