import { createHash, randomUUID } from "crypto";

import { QueueJob, queues } from "../lib/queue";
import { supabase } from "../db";
import { isUserCancelled } from "../lib/cancellation";
import {
  ClusteringSettings,
  normalizeClusteringSettings,
} from "../lib/clusteringSettings";
import { notifyPipelineBookmarkTerminal } from "../lib/pipelineCoordinator";
import { safeFetch } from "../lib/safeFetch";

import * as cheerio from "cheerio";

export interface EnrichmentJobData {
  userId: string;
  pipelineRunId?: string;
  jobGeneration?: number;
  clusteringSettings?: ClusteringSettings;
  bookmarkId: string;
  url: string;
}

const buildEmbeddingJobId = (
  userId: string,
  bookmarkId: string,
  pipelineRunId?: string,
  jobGeneration?: number,
) => {
  const runKey =
    pipelineRunId ??
    (jobGeneration !== undefined ? String(jobGeneration) : undefined);

  if (runKey) {
    return `embed-${userId}-run-${runKey}-${bookmarkId}`;
  }

  return `embed-${userId}-${bookmarkId}-${randomUUID()}`;
};

const getUrlLogId = (url: string) =>
  createHash("sha256").update(url).digest("hex").slice(0, 12);

const exitIfCancelled = async (
  userId: string,
  jobGeneration: number | undefined,
  pipelineRunId: string | undefined,
  bookmarkId: string,
  clusteringSettings: ClusteringSettings,
  checkpoint: string,
) => {
  if (!(await isUserCancelled(userId, jobGeneration, pipelineRunId))) {
    return false;
  }

  console.log(`[ENRICHMENT] Cancelled ${checkpoint} for user ${userId}`);
  await notifyPipelineBookmarkTerminal(
    userId,
    jobGeneration,
    pipelineRunId,
    bookmarkId,
    clusteringSettings,
  );
  return true;
};

export const enrichmentProcessor = async (job: QueueJob<EnrichmentJobData>) => {
  const { userId, pipelineRunId, jobGeneration, bookmarkId, url } = job.data;
  const clusteringSettings = normalizeClusteringSettings(
    job.data.clusteringSettings,
  );
  const urlLogId = getUrlLogId(url);
  console.log(`Enriching bookmark ${bookmarkId} (urlHash=${urlLogId})`);

  if (
    await exitIfCancelled(
      userId,
      jobGeneration,
      pipelineRunId,
      bookmarkId,
      clusteringSettings,
      "before start",
    )
  ) {
    return;
  }

  let description = "";

  try {
    const response = await safeFetch(url, { timeoutMs: 5000 });
    const html = await response.text();
    const $ = cheerio.load(html);
    description = $('meta[name="description"]').attr("content") || "";
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn(`[SCRAPE TIMEOUT] urlHash=${urlLogId}`);
    } else {
      console.warn(
        `[SCRAPE FAILED] urlHash=${urlLogId}: ${err.name || "Error"}`,
      );
    }
  }

  if (
    await exitIfCancelled(
      userId,
      jobGeneration,
      pipelineRunId,
      bookmarkId,
      clusteringSettings,
      "after fetch",
    )
  ) {
    return;
  }

  // Update DB
  const { error: enrichmentUpdateError } = await supabase
    .from("bookmarks")
    .update({ description, status: "enriched" })
    .eq("id", bookmarkId);
  if (enrichmentUpdateError) {
    console.error(
      `[ENRICHMENT] Failed to update bookmark ${bookmarkId}:`,
      enrichmentUpdateError,
    );
    await supabase
      .from("bookmarks")
      .update({ status: "error" })
      .eq("id", bookmarkId);
    try {
      await notifyPipelineBookmarkTerminal(
        userId,
        jobGeneration,
        pipelineRunId,
        bookmarkId,
        clusteringSettings,
      );
    } catch (notifyError) {
      console.error(
        `[ENRICHMENT] Failed to notify pipeline terminal state for bookmark ${bookmarkId} (jobGeneration=${jobGeneration}, pipelineRunId=${pipelineRunId})`,
        notifyError,
      );
      throw notifyError;
    }
    return;
  }

  if (
    await exitIfCancelled(
      userId,
      jobGeneration,
      pipelineRunId,
      bookmarkId,
      clusteringSettings,
      "before embedding enqueue",
    )
  ) {
    return;
  }

  // Add to Embedding Queue
  await queues.embedding.add(
    "embed",
    {
      userId,
      pipelineRunId,
      jobGeneration,
      clusteringSettings,
      bookmarkId,
      url,
    },
    {
      jobId: buildEmbeddingJobId(
        userId,
        bookmarkId,
        pipelineRunId,
        jobGeneration,
      ),
    },
  );
};
