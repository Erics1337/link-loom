import { supabase } from "../db";
import { ClusteringSettings } from "./clusteringSettings";
import { isUserCancelled } from "./cancellation";
import { getQueueDriver, queues } from "./queue";

const CLUSTERING_ENQUEUED_RECORD_ATTEMPTS = 3;
const CLUSTERING_ENQUEUE_WAIT_MS = 5_000;
const CLUSTERING_ENQUEUE_POLL_MS = 50;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getPipelineRunGeneration = async (
  userId: string,
  pipelineRunId: string | undefined,
  jobGeneration: number | undefined,
) => {
  if (typeof jobGeneration === "number") return jobGeneration;
  if (!pipelineRunId) return undefined;

  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("generation")
    .eq("id", pipelineRunId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(
      `[PIPELINE] Failed to resolve run generation ${pipelineRunId}`,
      error,
    );
    throw error;
  }

  return data?.generation == null ? undefined : Number(data.generation);
};

export const shouldExecutePipelineClustering = async (
  userId: string,
  jobGeneration: number | undefined,
  pipelineRunId: string | undefined,
): Promise<boolean> => {
  const generation = await getPipelineRunGeneration(
    userId,
    pipelineRunId,
    jobGeneration,
  );
  if (typeof generation !== "number") {
    return false;
  }

  const deadline = Date.now() + CLUSTERING_ENQUEUE_WAIT_MS;
  while (true) {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("totals, status")
      .eq("user_id", userId)
      .eq("generation", generation)
      .maybeSingle();

    if (error) {
      console.error(
        `[PIPELINE] Failed to read clustering enqueue state for user ${userId}`,
        error,
      );
      throw error;
    }

    if (!data || data.status !== "running") {
      return false;
    }

    const totals = (data.totals ?? {}) as Record<string, unknown>;
    if (totals.clusteringEnqueuedAt != null) {
      return true;
    }

    const claimId = totals.clusteringClaimId;
    const hasActiveClaim = typeof claimId === "string" && claimId.length > 0;
    if (!hasActiveClaim) {
      return false;
    }

    if (Date.now() >= deadline) {
      console.error(
        `[PIPELINE] Proceeding with clustering for user ${userId} generation ${generation} after waiting for clusteringEnqueuedAt`,
      );
      return true;
    }

    await delay(CLUSTERING_ENQUEUE_POLL_MS);
  }
};

export const recordPipelineRunStarted = async (
  userId: string,
  jobGeneration: number,
  totalBookmarks: number,
  clusteringSettings: ClusteringSettings,
) => {
  const { error } = await supabase.rpc("record_user_pipeline_started", {
    p_user_id: userId,
    p_job_generation: jobGeneration,
    p_total_bookmarks: totalBookmarks,
    p_clustering_settings: clusteringSettings,
  });

  if (error) {
    console.error(
      `[PIPELINE] Failed to record run start for user ${userId}`,
      error,
    );
    throw error;
  }
};

export const recordPipelineIngestTotal = async (
  userId: string,
  jobGeneration: number | undefined,
  pipelineRunId: string | undefined,
  totalBookmarks: number,
) => {
  const generation = await getPipelineRunGeneration(
    userId,
    pipelineRunId,
    jobGeneration,
  );
  if (typeof generation !== "number") return;

  const { error } = await supabase.rpc("record_user_pipeline_ingest_total", {
    p_user_id: userId,
    p_job_generation: generation,
    p_total_bookmarks: totalBookmarks,
  });

  if (error) {
    console.error(
      `[PIPELINE] Failed to record ingest total for user ${userId}`,
      error,
    );
    throw error;
  }
};

export const recordPipelineIngestCompleted = async (
  userId: string,
  jobGeneration: number | undefined,
  pipelineRunId: string | undefined,
  clusteringSettings: ClusteringSettings,
) => {
  const generation = await getPipelineRunGeneration(
    userId,
    pipelineRunId,
    jobGeneration,
  );
  if (typeof generation !== "number") return;

  const { error } = await supabase.rpc(
    "record_user_pipeline_ingest_completed",
    {
      p_user_id: userId,
      p_job_generation: generation,
    },
  );

  if (error) {
    console.error(
      `[PIPELINE] Failed to record ingest completion for user ${userId}`,
      error,
    );
    throw error;
  }

  await maybeEnqueueClustering(
    userId,
    generation,
    pipelineRunId,
    clusteringSettings,
  );
};

export const recordPipelineUntrackedError = async (
  userId: string,
  jobGeneration: number | undefined,
  pipelineRunId?: string,
  clusteringSettings?: ClusteringSettings,
  errorKey?: string,
) => {
  const generation = await getPipelineRunGeneration(
    userId,
    pipelineRunId,
    jobGeneration,
  );
  if (typeof generation !== "number") return;

  const { error } = await supabase.rpc("record_user_pipeline_untracked_error", {
    p_user_id: userId,
    p_job_generation: generation,
    p_error_key: errorKey ?? null,
  });

  if (error) {
    console.error(
      `[PIPELINE] Failed to record untracked error for user ${userId}`,
      error,
    );
    throw error;
  }

  if (clusteringSettings) {
    await maybeEnqueueClustering(
      userId,
      generation,
      pipelineRunId,
      clusteringSettings,
    );
  }
};

export const notifyPipelineBookmarkTerminal = async (
  userId: string,
  jobGeneration: number | undefined,
  pipelineRunId: string | undefined,
  bookmarkId: string | undefined,
  clusteringSettings: ClusteringSettings,
) => {
  const generation = await getPipelineRunGeneration(
    userId,
    pipelineRunId,
    jobGeneration,
  );
  if (typeof generation !== "number") return;

  if (bookmarkId) {
    const { data: isReady, error } = await supabase.rpc(
      "record_user_pipeline_bookmark_terminal",
      {
        p_user_id: userId,
        p_job_generation: generation,
        p_bookmark_id: bookmarkId,
      },
    );

    if (error) {
      console.error(
        `[PIPELINE] Failed to record terminal bookmark ${bookmarkId} for user ${userId}`,
        error,
      );
      throw error;
    }

    if (!isReady) return;
  }

  await maybeEnqueueClustering(
    userId,
    generation,
    pipelineRunId,
    clusteringSettings,
  );
};

export const recordPipelineClusteringCompleted = async (
  userId: string,
  jobGeneration: number | undefined,
  pipelineRunId?: string,
) => {
  const generation = await getPipelineRunGeneration(
    userId,
    pipelineRunId,
    jobGeneration,
  );
  if (typeof generation !== "number") return;

  const { error } = await supabase.rpc(
    "record_user_pipeline_clustering_completed",
    {
      p_user_id: userId,
      p_job_generation: generation,
    },
  );

  if (error) {
    console.error(
      `[PIPELINE] Failed to record clustering completion for user ${userId}`,
      error,
    );
    throw error;
  }
};

const maybeEnqueueClustering = async (
  userId: string,
  jobGeneration: number,
  pipelineRunId: string | undefined,
  clusteringSettings: ClusteringSettings,
) => {
  if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
    return false;
  }

  const { data: claimId, error } = await supabase.rpc(
    "claim_user_pipeline_clustering",
    {
      p_user_id: userId,
      p_job_generation: jobGeneration,
    },
  );

  if (error) {
    console.error(
      `[PIPELINE] Failed to evaluate clustering readiness for user ${userId}`,
      error,
    );
    throw error;
  }

  if (!claimId) return false;

  const jobId = `cluster-${userId}-run-${pipelineRunId || jobGeneration}`;
  console.log(
    `[PIPELINE] Run ${jobGeneration} ready; queueing clustering for user ${userId}`,
  );
  try {
    await queues.clustering.add(
      "cluster",
      { userId, pipelineRunId, jobGeneration, clusteringSettings },
      { jobId },
    );
  } catch (queueError) {
    const { error: releaseError } = await supabase.rpc(
      "release_user_pipeline_clustering_claim",
      {
        p_user_id: userId,
        p_job_generation: jobGeneration,
        p_claim_id: claimId,
      },
    );

    if (releaseError) {
      console.error(
        `[PIPELINE] Failed to release clustering claim for user ${userId}`,
        releaseError,
      );
    }

    throw queueError;
  }

  let recordEnqueuedError: unknown = null;
  for (
    let attempt = 1;
    attempt <= CLUSTERING_ENQUEUED_RECORD_ATTEMPTS;
    attempt++
  ) {
    const { error } = await supabase.rpc(
      "record_user_pipeline_clustering_enqueued",
      {
        p_user_id: userId,
        p_job_generation: jobGeneration,
        p_claim_id: claimId,
      },
    );

    if (!error) {
      recordEnqueuedError = null;
      break;
    }

    recordEnqueuedError = error;
    console.error(
      `[PIPELINE] Failed to record clustering enqueue for user ${userId} (attempt ${attempt}/${CLUSTERING_ENQUEUED_RECORD_ATTEMPTS}, jobId=${jobId})`,
      error,
    );
    if (attempt < CLUSTERING_ENQUEUED_RECORD_ATTEMPTS) {
      await delay(25 * attempt);
    }
  }

  if (recordEnqueuedError) {
    const { error: releaseError } = await supabase.rpc(
      "release_user_pipeline_clustering_claim",
      {
        p_user_id: userId,
        p_job_generation: jobGeneration,
        p_claim_id: claimId,
      },
    );

    if (releaseError) {
      console.error(
        `[PIPELINE] Failed to release clustering claim after enqueue-record failure for user ${userId} (claim_user_pipeline_clustering claimId=${claimId}, jobId=${jobId})`,
        releaseError,
      );
    } else {
      console.error(
        `[PIPELINE] Released clustering claim after enqueue-record failure for user ${userId} (release_user_pipeline_clustering_claim claimId=${claimId}, jobId=${jobId})`,
      );
    }

    const removedQueuedJob = await queues.clustering.remove(jobId);
    if (!removedQueuedJob && getQueueDriver() !== "test") {
      console.error(
        `[PIPELINE] Could not remove queued clustering job after enqueue-record failure (queues.clustering.remove jobId=${jobId}, userId=${userId}, generation=${jobGeneration}, claimId=${claimId}). Claim was released; orphaned job delivery will be skipped unless clusteringEnqueuedAt is recorded.`,
        { userId, jobGeneration, claimId, jobId },
      );
    } else {
      console.error(
        `[PIPELINE] Attempted to remove queued clustering job after enqueue-record failure (queues.clustering.add jobId=${jobId}, removed=${removedQueuedJob})`,
      );
    }
    throw recordEnqueuedError;
  }

  return true;
};
