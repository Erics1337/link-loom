import { SQSEvent } from "aws-lambda";
import {
  createQueueJob,
  parseQueuedMessage,
  QueueName,
  QueuedMessage,
} from "../lib/queue";
import { ingestProcessor } from "../queues/ingest";
import { enrichmentProcessor } from "../queues/enrichment";
import { embeddingProcessor } from "../queues/embedding";
import { clusteringProcessor } from "../queues/clustering";
import { supabase } from "../db";
import { normalizeClusteringSettings } from "../lib/clusteringSettings";
import { isUserCancelled } from "../lib/cancellation";
import {
  notifyPipelineBookmarkTerminal,
  recordPipelineUntrackedError,
} from "../lib/pipelineCoordinator";
import { prepareQueueJobFailureError } from "../lib/sanitizeQueueError";

const processors = {
  ingest: ingestProcessor,
  enrichment: enrichmentProcessor,
  embedding: embeddingProcessor,
  clustering: clusteringProcessor,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getReceiveCount = (record: SQSEvent["Records"][number]) => {
  const raw = record.attributes?.ApproximateReceiveCount;
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const getFailureScope = (message: QueuedMessage) => {
  if (!isObject(message.data)) return {};

  const userId =
    typeof message.data.userId === "string" ? message.data.userId : undefined;
  const pipelineRunId =
    typeof message.data.pipelineRunId === "string"
      ? message.data.pipelineRunId
      : undefined;
  const jobGeneration =
    typeof message.data.jobGeneration === "number"
      ? message.data.jobGeneration
      : undefined;
  const clusteringSettings = normalizeClusteringSettings(
    message.data.clusteringSettings,
  );
  const bookmarkId =
    typeof message.data.bookmarkId === "string"
      ? message.data.bookmarkId
      : undefined;
  const chromeIds = Array.isArray(message.data.bookmarks)
    ? message.data.bookmarks
        .filter(isObject)
        .map((bookmark) => bookmark.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  return {
    userId,
    pipelineRunId,
    jobGeneration,
    clusteringSettings,
    bookmarkId,
    chromeIds,
  };
};

const recordQueueJobFailure = async (
  queueName: QueueName,
  message: QueuedMessage,
  fallbackJobId: string,
  receiveCount: number,
  error: unknown,
) => {
  const {
    userId,
    pipelineRunId,
    jobGeneration,
    clusteringSettings,
    bookmarkId,
    chromeIds,
  } = getFailureScope(message);
  const jobId = message.jobId ?? fallbackJobId;
  const { error_message_sanitized, error_message_hash } =
    prepareQueueJobFailureError(error);

  const { error: failureError } = await supabase
    .from("queue_job_failures")
    .upsert(
      {
        queue_name: queueName,
        job_id: jobId,
        job_name: message.jobName,
        user_id: userId,
        pipeline_run_id: pipelineRunId,
        bookmark_id: bookmarkId,
        attempts: message.attempts,
        receive_count: receiveCount,
        error_message_sanitized,
        error_message_hash,
        failed_at: new Date().toISOString(),
      },
      { onConflict: "queue_name,job_id" },
    );

  if (failureError) {
    console.error(
      `[LAMBDA:${queueName}] Failed to record queue job failure ${jobId}`,
      failureError,
    );
  }

  if (userId && (await isUserCancelled(userId, jobGeneration, pipelineRunId))) {
    console.log(
      `[LAMBDA:${queueName}] Skipping stale exhausted job mutation for ${jobId}`,
    );
    return;
  }

  if (bookmarkId) {
    let updateQuery = supabase
      .from("bookmarks")
      .update({ status: "error" })
      .eq("id", bookmarkId);

    if (pipelineRunId) {
      updateQuery = updateQuery.eq("pipeline_run_id", pipelineRunId);
    }

    const { error: bookmarkError } = await updateQuery;
    if (bookmarkError) {
      console.error(
        `[LAMBDA:${queueName}] Failed to mark bookmark ${bookmarkId} as error`,
        bookmarkError,
      );
    } else if (userId) {
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
          `[LAMBDA:${queueName}] Failed to notify pipeline terminal for bookmark ${bookmarkId}`,
          notifyError,
        );
      }
    }
  } else if (userId && chromeIds && chromeIds.length > 0) {
    let updateQuery = supabase
      .from("bookmarks")
      .update({ status: "error" })
      .eq("user_id", userId)
      .in("chrome_id", chromeIds);

    if (pipelineRunId) {
      updateQuery = updateQuery.eq("pipeline_run_id", pipelineRunId);
    }

    const { error: bookmarkError } = await updateQuery;
    if (bookmarkError) {
      console.error(
        `[LAMBDA:${queueName}] Failed to mark exhausted ingest bookmarks as error`,
        bookmarkError,
      );
    } else {
      try {
        await Promise.all(
          chromeIds.map((chromeId) =>
            recordPipelineUntrackedError(
              userId,
              jobGeneration,
              pipelineRunId,
              clusteringSettings,
              `exhausted:${jobId}:${chromeId}`,
            ),
          ),
        );
      } catch (untrackedError) {
        console.error(
          `[LAMBDA:${queueName}] Failed to record exhausted ingest untracked errors for ${jobId}`,
          untrackedError,
        );
      }
    }
  }
};

const recordFallbackQueueFailure = async (
  queueName: QueueName,
  messageId: string,
  receiveCount: number,
  error: unknown,
) => {
  const { error_message_sanitized, error_message_hash } =
    prepareQueueJobFailureError(error);

  const { error: failureError } = await supabase
    .from("queue_job_failures")
    .upsert(
      {
        queue_name: queueName,
        job_id: messageId,
        job_name: "unknown",
        attempts: 1,
        receive_count: receiveCount,
        error_message_sanitized,
        error_message_hash,
        failed_at: new Date().toISOString(),
      },
      { onConflict: "queue_name,job_id" },
    );

  if (failureError) {
    console.error(
      `[LAMBDA:${queueName}] Failed to record fallback queue job failure ${messageId}`,
      failureError,
    );
  }
};

const processRecord = async (queueName: QueueName, message: QueuedMessage) => {
  if (message.queue !== queueName) {
    throw new Error(
      `Expected ${queueName} message but received ${message.queue}`,
    );
  }

  await processors[queueName](createQueueJob(message.data as any) as any);
};

export const processEvent = async (queueName: QueueName, event: SQSEvent) => {
  const failures: Array<{ itemIdentifier: string }> = [];

  await Promise.all(
    event.Records.map(async (record) => {
      let message: QueuedMessage | undefined;
      try {
        message = parseQueuedMessage(record.body);
        await processRecord(queueName, message);
      } catch (error) {
        const { error_message_sanitized } = prepareQueueJobFailureError(error);
        console.error(
          `[LAMBDA:${queueName}] Failed to process message ${record.messageId}: ${error_message_sanitized}`,
        );
        const receiveCount = getReceiveCount(record);
        if (message) {
          if (receiveCount >= message.attempts) {
            await recordQueueJobFailure(
              queueName,
              message,
              record.messageId,
              receiveCount,
              error,
            );
          }
        } else {
          await recordFallbackQueueFailure(
            queueName,
            record.messageId,
            receiveCount,
            error,
          );
        }
        failures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures: failures };
};

export const ingestHandler = (event: SQSEvent) => processEvent("ingest", event);
export const enrichmentHandler = (event: SQSEvent) =>
  processEvent("enrichment", event);
export const embeddingHandler = (event: SQSEvent) =>
  processEvent("embedding", event);
export const clusteringHandler = (event: SQSEvent) =>
  processEvent("clustering", event);
