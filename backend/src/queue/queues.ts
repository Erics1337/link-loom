import { Queue } from 'bullmq';
import { connection } from './connection';

export const QUEUE_NAMES = {
    ENRICHMENT: 'enrichment-queue',
    EMBEDDING: 'embedding-queue',
    RENAMING: 'renaming-queue',
    CLUSTERING: 'clustering-queue',
};

export const enrichmentQueue = new Queue(QUEUE_NAMES.ENRICHMENT, { connection });
export const embeddingQueue = new Queue(QUEUE_NAMES.EMBEDDING, { connection });
export const renamingQueue = new Queue(QUEUE_NAMES.RENAMING, { connection });
export const clusteringQueue = new Queue(QUEUE_NAMES.CLUSTERING, { connection });
