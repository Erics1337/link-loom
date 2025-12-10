import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    // Add logic to prevent crashing on connection error
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

connection.on('error', (err: any) => {
    if (err.code === 'ECONNREFUSED') {
        console.error('\x1b[31m%s\x1b[0m', 'Create Connection Error: Failed to connect to Redis.');
        console.error('\x1b[33m%s\x1b[0m', 'Make sure Docker is running and the Redis service is started:');
        console.error('\x1b[36m%s\x1b[0m', '  docker-compose up -d redis');
    } else {
        console.error('Redis connection error:', err);
    }
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
