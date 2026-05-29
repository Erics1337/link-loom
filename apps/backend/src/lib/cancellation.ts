import { supabase } from '../db';

type PipelineControlRow = {
    is_cancelled: boolean;
    job_generation: number;
};

const readPipelineControl = async (userId: string): Promise<PipelineControlRow | null> => {
    const { data, error } = await supabase
        .from('user_pipeline_controls')
        .select('is_cancelled, job_generation')
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
    };
};

const persistPipelineControl = async (
    userId: string,
    isCancelled: boolean,
    jobGeneration: number
) => {
    const { error } = await supabase
        .from('user_pipeline_controls')
        .upsert(
            {
                user_id: userId,
                is_cancelled: isCancelled,
                job_generation: jobGeneration,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        );

    if (error) {
        console.error(
            `[CANCEL] Failed to persist cancellation=${isCancelled}, generation=${jobGeneration} for user ${userId}`,
            error
        );
        throw error;
    }
};

export const beginUserPipelineRun = async (userId: string) => {
    const current = await readPipelineControl(userId);
    const nextGeneration = (current?.job_generation ?? 0) + 1;
    await persistPipelineControl(userId, false, nextGeneration);
    return nextGeneration;
};

export const clearUserCancelled = async (userId: string) => {
    return beginUserPipelineRun(userId);
};

export const markUserCancelled = async (userId: string) => {
    const current = await readPipelineControl(userId);
    await persistPipelineControl(userId, true, current?.job_generation ?? 0);
};

export const isUserCancelled = async (userId: string, jobGeneration?: number) => {
    try {
        const current = await readPipelineControl(userId);

        if (!current) return false;

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
