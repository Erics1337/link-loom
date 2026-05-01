import { SQSEvent } from 'aws-lambda';
import { createQueueJob, parseQueuedMessage, QueueName } from '../lib/queue';
import { ingestProcessor } from '../queues/ingest';
import { enrichmentProcessor } from '../queues/enrichment';
import { embeddingProcessor } from '../queues/embedding';
import { clusteringProcessor } from '../queues/clustering';

const processors = {
    ingest: ingestProcessor,
    enrichment: enrichmentProcessor,
    embedding: embeddingProcessor,
    clustering: clusteringProcessor,
};

const processRecord = async (queueName: QueueName, body: string) => {
    const message = parseQueuedMessage(body);
    if (message.queue !== queueName) {
        throw new Error(`Expected ${queueName} message but received ${message.queue}`);
    }

    await processors[queueName](createQueueJob(message.data as any) as any);
};

const processEvent = async (queueName: QueueName, event: SQSEvent) => {
    const failures: Array<{ itemIdentifier: string }> = [];

    await Promise.all(event.Records.map(async (record) => {
        try {
            await processRecord(queueName, record.body);
        } catch (error) {
            console.error(`[LAMBDA:${queueName}] Failed to process message ${record.messageId}`, error);
            failures.push({ itemIdentifier: record.messageId });
        }
    }));

    return { batchItemFailures: failures };
};

export const ingestHandler = (event: SQSEvent) => processEvent('ingest', event);
export const enrichmentHandler = (event: SQSEvent) => processEvent('enrichment', event);
export const embeddingHandler = (event: SQSEvent) => processEvent('embedding', event);
export const clusteringHandler = (event: SQSEvent) => processEvent('clustering', event);
