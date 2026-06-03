import { supabase } from '../db';
import { ClusteringSettings } from './clusteringSettings';
import { isUserCancelled } from './cancellation';
import { queues } from './queue';

const getPipelineRunGeneration = async (
    userId: string,
    pipelineRunId: string | undefined,
    jobGeneration: number | undefined
) => {
    if (typeof jobGeneration === 'number') return jobGeneration;
    if (!pipelineRunId) return undefined;

    const { data, error } = await supabase
        .from('pipeline_runs')
        .select('generation')
        .eq('id', pipelineRunId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error(`[PIPELINE] Failed to resolve run generation ${pipelineRunId}`, error);
        throw error;
    }

    return data?.generation == null ? undefined : Number(data.generation);
};

export const recordPipelineRunStarted = async (
    userId: string,
    jobGeneration: number,
    totalBookmarks: number,
    clusteringSettings: ClusteringSettings
) => {
    const { error } = await supabase.rpc('record_user_pipeline_started', {
        p_user_id: userId,
        p_job_generation: jobGeneration,
        p_total_bookmarks: totalBookmarks,
        p_clustering_settings: clusteringSettings,
    });

    if (error) {
        console.error(`[PIPELINE] Failed to record run start for user ${userId}`, error);
        throw error;
    }
};

export const recordPipelineIngestCompleted = async (
    userId: string,
    jobGeneration: number | undefined,
    pipelineRunId: string | undefined,
    clusteringSettings: ClusteringSettings
) => {
    const generation = await getPipelineRunGeneration(userId, pipelineRunId, jobGeneration);
    if (typeof generation !== 'number') return;

    const { error } = await supabase.rpc('record_user_pipeline_ingest_completed', {
        p_user_id: userId,
        p_job_generation: generation,
    });

    if (error) {
        console.error(`[PIPELINE] Failed to record ingest completion for user ${userId}`, error);
        throw error;
    }

    await maybeEnqueueClustering(userId, generation, pipelineRunId, clusteringSettings);
};

export const recordPipelineUntrackedError = async (
    userId: string,
    jobGeneration: number | undefined,
    pipelineRunId?: string,
    clusteringSettings?: ClusteringSettings,
    errorKey?: string
) => {
    const generation = await getPipelineRunGeneration(userId, pipelineRunId, jobGeneration);
    if (typeof generation !== 'number') return;

    const { error } = await supabase.rpc('record_user_pipeline_untracked_error', {
        p_user_id: userId,
        p_job_generation: generation,
        p_error_key: errorKey ?? null,
    });

    if (error) {
        console.error(`[PIPELINE] Failed to record untracked error for user ${userId}`, error);
        throw error;
    }

    if (clusteringSettings) {
        await maybeEnqueueClustering(userId, generation, pipelineRunId, clusteringSettings);
    }
};

export const notifyPipelineBookmarkTerminal = async (
    userId: string,
    jobGeneration: number | undefined,
    pipelineRunId: string | undefined,
    clusteringSettings: ClusteringSettings
) => {
    const generation = await getPipelineRunGeneration(userId, pipelineRunId, jobGeneration);
    if (typeof generation !== 'number') return;
    await maybeEnqueueClustering(userId, generation, pipelineRunId, clusteringSettings);
};

export const recordPipelineClusteringCompleted = async (
    userId: string,
    jobGeneration: number | undefined,
    pipelineRunId?: string
) => {
    const generation = await getPipelineRunGeneration(userId, pipelineRunId, jobGeneration);
    if (typeof generation !== 'number') return;

    const { error } = await supabase.rpc('record_user_pipeline_clustering_completed', {
        p_user_id: userId,
        p_job_generation: generation,
    });

    if (error) {
        console.error(`[PIPELINE] Failed to record clustering completion for user ${userId}`, error);
        throw error;
    }
};

const maybeEnqueueClustering = async (
    userId: string,
    jobGeneration: number,
    pipelineRunId: string | undefined,
    clusteringSettings: ClusteringSettings
) => {
    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        return false;
    }

    const { data: shouldEnqueue, error } = await supabase.rpc('claim_user_pipeline_clustering', {
        p_user_id: userId,
        p_job_generation: jobGeneration,
    });

    if (error) {
        console.error(`[PIPELINE] Failed to evaluate clustering readiness for user ${userId}`, error);
        throw error;
    }

    if (!shouldEnqueue) return false;

    console.log(`[PIPELINE] Run ${jobGeneration} ready; queueing clustering for user ${userId}`);
    await queues.clustering.add(
        'cluster',
        { userId, pipelineRunId, clusteringSettings },
        { jobId: `cluster-${userId}-run-${pipelineRunId || jobGeneration}` }
    );

    return true;
};
