import { SQSEvent } from 'aws-lambda';
import { createQueueJob, parseQueuedMessage, QueueName, QueuedMessage } from '../lib/queue';
import { ingestProcessor } from '../queues/ingest';
import { enrichmentProcessor } from '../queues/enrichment';
import { embeddingProcessor } from '../queues/embedding';
import { clusteringProcessor } from '../queues/clustering';
import { supabase } from '../db';

const processors = {
    ingest: ingestProcessor,
    enrichment: enrichmentProcessor,
    embedding: embeddingProcessor,
    clustering: clusteringProcessor,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

const getReceiveCount = (record: SQSEvent['Records'][number]) => {
    const raw = record.attributes?.ApproximateReceiveCount;
    const parsed = Number.parseInt(raw ?? '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const getFailureScope = (message: QueuedMessage) => {
    if (!isObject(message.data)) return {};

    const userId = typeof message.data.userId === 'string' ? message.data.userId : undefined;
    const bookmarkId = typeof message.data.bookmarkId === 'string' ? message.data.bookmarkId : undefined;
    const chromeIds = Array.isArray(message.data.bookmarks)
        ? message.data.bookmarks
            .filter(isObject)
            .map((bookmark) => bookmark.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];

    return { userId, bookmarkId, chromeIds };
};

const recordQueueJobFailure = async (
    queueName: QueueName,
    message: QueuedMessage,
    fallbackJobId: string,
    receiveCount: number,
    error: unknown,
) => {
    const { userId, bookmarkId, chromeIds } = getFailureScope(message);
    const jobId = message.jobId ?? fallbackJobId;
    const errorMessage = getErrorMessage(error).slice(0, 1000);

    const { error: failureError } = await supabase
        .from('queue_job_failures')
        .upsert({
            queue_name: queueName,
            job_id: jobId,
            job_name: message.jobName,
            user_id: userId,
            bookmark_id: bookmarkId,
            attempts: message.attempts,
            receive_count: receiveCount,
            error_message: errorMessage,
            failed_at: new Date().toISOString(),
        }, { onConflict: 'queue_name,job_id' });

    if (failureError) {
        console.error(`[LAMBDA:${queueName}] Failed to record queue job failure ${jobId}`, failureError);
    }

    if (bookmarkId) {
        const { error: bookmarkError } = await supabase
            .from('bookmarks')
            .update({ status: 'error' })
            .eq('id', bookmarkId);
        if (bookmarkError) {
            console.error(`[LAMBDA:${queueName}] Failed to mark bookmark ${bookmarkId} as error`, bookmarkError);
        }
    } else if (userId && chromeIds && chromeIds.length > 0) {
        const { error: bookmarkError } = await supabase
            .from('bookmarks')
            .update({ status: 'error' })
            .eq('user_id', userId)
            .in('chrome_id', chromeIds);
        if (bookmarkError) {
            console.error(`[LAMBDA:${queueName}] Failed to mark exhausted ingest bookmarks as error`, bookmarkError);
        }
    }
};

const processRecord = async (queueName: QueueName, message: QueuedMessage) => {
    if (message.queue !== queueName) {
        throw new Error(`Expected ${queueName} message but received ${message.queue}`);
    }

    await processors[queueName](createQueueJob(message.data as any) as any);
};

export const processEvent = async (queueName: QueueName, event: SQSEvent) => {
    const failures: Array<{ itemIdentifier: string }> = [];

    await Promise.all(event.Records.map(async (record) => {
        let message: QueuedMessage | undefined;
        try {
            message = parseQueuedMessage(record.body);
            await processRecord(queueName, message);
        } catch (error) {
            console.error(`[LAMBDA:${queueName}] Failed to process message ${record.messageId}`, error);
            const receiveCount = getReceiveCount(record);
            if (message && receiveCount >= message.attempts) {
                await recordQueueJobFailure(queueName, message, record.messageId, receiveCount, error);
            }
            failures.push({ itemIdentifier: record.messageId });
        }
    }));

    return { batchItemFailures: failures };
};

export const ingestHandler = (event: SQSEvent) => processEvent('ingest', event);
export const enrichmentHandler = (event: SQSEvent) => processEvent('enrichment', event);
export const embeddingHandler = (event: SQSEvent) => processEvent('embedding', event);
export const clusteringHandler = (event: SQSEvent) => processEvent('clustering', event);
