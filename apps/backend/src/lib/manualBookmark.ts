import { randomUUID } from "crypto";
import { supabase } from "../db";
import { queues } from "./queue";
import { beginUserPipelineRun, failPipelineRun } from "./cancellation";
import {
  ClusteringSettings,
  normalizeClusteringSettings,
} from "./clusteringSettings";
import { recordPipelineRunStarted } from "./pipelineCoordinator";

type QueueManualBookmarkInput = {
  userId: string;
  rawUrl: string;
  title?: string;
  freeTierLimit: number;
  isPremium: boolean;
  clusteringSettings?: ClusteringSettings;
};

export type QueueManualBookmarkResult =
  | { ok: true; chromeId: string }
  | { ok: false; statusCode: number; payload: Record<string, unknown> };

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const queueManualBookmark = async ({
  userId,
  rawUrl,
  title,
  freeTierLimit,
  isPremium,
  clusteringSettings,
}: QueueManualBookmarkInput): Promise<QueueManualBookmarkResult> => {
  const trimmedUrl = rawUrl.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: "A valid URL is required." },
    };
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: "Only http and https URLs can be saved." },
    };
  }

  if (!isPremium) {
    const { count: existingCount, error: countError } = await supabase
      .from("bookmarks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      console.error("[BOOKMARKS] Failed to count bookmarks:", countError);
      return {
        ok: false,
        statusCode: 500,
        payload: { error: "Failed to check bookmark limit" },
      };
    }

    if ((existingCount ?? 0) >= freeTierLimit) {
      return {
        ok: false,
        statusCode: 402,
        payload: {
          error: "Bookmark limit exceeded",
          message: `Free tier allows up to ${freeTierLimit} bookmarks stored in Link Loom.`,
          limit: freeTierLimit,
          current: existingCount ?? 0,
          attempted: 1,
          upgradeUrl: "/dashboard/billing",
        },
      };
    }
  }

  const pipelineRun = await beginUserPipelineRun(userId);
  const normalizedClusteringSettings =
    normalizeClusteringSettings(clusteringSettings);
  await recordPipelineRunStarted(
    userId,
    pipelineRun.generation,
    1,
    normalizedClusteringSettings,
  );

  const { error: deleteClustersError } = await supabase
    .from("clusters")
    .delete()
    .eq("user_id", userId);

  if (deleteClustersError) {
    console.warn(
      `[BOOKMARKS] Warning: Failed to clear old clusters for user ${userId}`,
      deleteClustersError,
    );
  }

  const chromeId = `manual-${randomUUID()}`;
  try {
    await queues.ingest.add(
      "ingest",
      {
        userId,
        pipelineRunId: pipelineRun.id,
        jobGeneration: pipelineRun.generation,
        bookmarks: [
          {
            id: chromeId,
            url: parsedUrl.toString(),
            title: title?.trim() || parsedUrl.toString(),
          },
        ],
        clusteringSettings: normalizedClusteringSettings,
      },
      {
        jobId: `ingest-${userId}-manual-run-${pipelineRun.id || pipelineRun.generation}`,
      },
    );
  } catch (error) {
    console.error(
      `[BOOKMARKS] Failed to enqueue manual bookmark pipeline run ${pipelineRun.id} (generation=${pipelineRun.generation})`,
      error,
    );

    try {
      await failPipelineRun(pipelineRun.id, {
        reason: "enqueue_failed",
        generation: pipelineRun.generation,
        error: getErrorMessage(error),
      });
    } catch (failError) {
      console.error(
        `[BOOKMARKS] Failed to mark manual bookmark pipeline run ${pipelineRun.id} failed after enqueue error`,
        failError,
      );
    }

    return {
      ok: false,
      statusCode: 500,
      payload: { error: "Failed to queue bookmark" },
    };
  }

  return { ok: true, chromeId };
};
