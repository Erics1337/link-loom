import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

export const createQueue = (name: string) => new Queue(name, { connection });
export const createWorker = (name: string, processor: any) => new Worker(name, processor, { connection });
export const createQueueEvents = (name: string) => new QueueEvents(name, { connection });

export const queues = {
    ingest: createQueue('ingest'),
    enrichment: createQueue('enrichment'),
    embedding: createQueue('embedding'),
    clustering: createQueue('clustering'),
};
