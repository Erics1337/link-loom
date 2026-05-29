import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

export type QueueName = 'ingest' | 'enrichment' | 'embedding' | 'clustering';

export type QueueJob<T = unknown> = {
    data: T;
    updateProgress: (progress: unknown) => Promise<void>;
};

export type QueueProcessor<T = unknown> = (job: QueueJob<T>) => Promise<void>;

type QueueAddOptions = {
    delay?: number;
    jobId?: string;
    attempts?: number;
    backoffMs?: number;
};

export type QueuedMessage = {
    queue: QueueName;
    jobName: string;
    data: unknown;
    jobId?: string;
    attempts: number;
    backoffMs: number;
};

type TestQueuedJob = QueuedMessage & {
    id: string;
    delay?: number;
};

const defaultRetryPolicyByQueue: Record<QueueName, { attempts: number; backoffMs: number }> = {
    ingest: { attempts: 5, backoffMs: 30000 },
    enrichment: { attempts: 5, backoffMs: 30000 },
    embedding: { attempts: 5, backoffMs: 30000 },
    clustering: { attempts: 3, backoffMs: 60000 },
};

const queueDriver = process.env.QUEUE_DRIVER ?? (process.env.AWS_LAMBDA_FUNCTION_NAME ? 'sqs' : 'inline');
const sqs = new SQSClient({});
const processors = new Map<QueueName, QueueProcessor>();
const testQueuedJobs: TestQueuedJob[] = [];

const queueUrlEnvByName: Record<QueueName, string> = {
    ingest: 'INGEST_QUEUE_URL',
    enrichment: 'ENRICHMENT_QUEUE_URL',
    embedding: 'EMBEDDING_QUEUE_URL',
    clustering: 'CLUSTERING_QUEUE_URL',
};

export const createQueueJob = <T>(data: T): QueueJob<T> => ({
    data,
    updateProgress: async () => {
        // SQS/Lambda does not expose mutable job progress. Progress belongs in the DB.
    },
});

class AppQueue<T = unknown> {
    constructor(private readonly name: QueueName) {}

    registerProcessor(processor: QueueProcessor<T>) {
        processors.set(this.name, processor as QueueProcessor);
    }

    async add(jobName: string, data: T, options: QueueAddOptions = {}) {
        const jobId = options.jobId ?? `${this.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const retryPolicy = defaultRetryPolicyByQueue[this.name];
        const attempts = options.attempts ?? retryPolicy.attempts;
        const backoffMs = options.backoffMs ?? retryPolicy.backoffMs;

        if (queueDriver === 'test') {
            testQueuedJobs.push({
                id: jobId,
                queue: this.name,
                jobName,
                data,
                jobId,
                attempts,
                backoffMs,
                delay: options.delay,
            });
            return { id: jobId, data, attempts, backoffMs };
        }

        if (queueDriver === 'sqs') {
            const queueUrl = process.env[queueUrlEnvByName[this.name]];
            if (!queueUrl) {
                throw new Error(`Missing ${queueUrlEnvByName[this.name]} for SQS queue ${this.name}`);
            }

            const body: QueuedMessage = {
                queue: this.name,
                jobName,
                data,
                jobId,
                attempts,
                backoffMs,
            };

            await sqs.send(new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(body),
                DelaySeconds: options.delay ? Math.min(Math.ceil(options.delay / 1000), 900) : undefined,
            }));

            return { id: jobId, data, attempts, backoffMs };
        }

        const processor = processors.get(this.name);
        if (!processor) {
            throw new Error(`No inline processor registered for queue ${this.name}`);
        }

        const run = () => {
            processor(createQueueJob(data)).catch((error) => {
                console.error(`[QUEUE:${this.name}] Inline job failed`, error);
            });
        };

        if (options.delay && options.delay > 0) {
            setTimeout(run, options.delay);
        } else {
            queueMicrotask(run);
        }

        return { id: jobId, data, attempts, backoffMs };
    }
}

export const createWorker = <T>(name: QueueName, processor: QueueProcessor<T>, _options: unknown = {}) => {
    queues[name].registerProcessor(processor);
};

const queueNames = new Set<QueueName>(['ingest', 'enrichment', 'embedding', 'clustering']);

export const parseQueuedMessage = (raw: string): QueuedMessage => {
    const message = JSON.parse(raw) as Partial<QueuedMessage>;
    if (!message.queue || !queueNames.has(message.queue) || !message.jobName || !('data' in message)) {
        throw new Error('Invalid queue message');
    }

    const retryPolicy = defaultRetryPolicyByQueue[message.queue];
    const attempts = Number.isFinite(message.attempts) && Number(message.attempts) > 0
        ? Number(message.attempts)
        : retryPolicy.attempts;
    const backoffMs = Number.isFinite(message.backoffMs) && Number(message.backoffMs) >= 0
        ? Number(message.backoffMs)
        : retryPolicy.backoffMs;

    return {
        queue: message.queue,
        jobName: message.jobName,
        data: message.data,
        jobId: message.jobId,
        attempts,
        backoffMs,
    };
};

export const getTestQueuedJobs = () => [...testQueuedJobs];

export const clearTestQueuedJobs = () => {
    testQueuedJobs.length = 0;
};

export const drainTestQueuedJobs = async (maxJobs = 50) => {
    const processed: Array<{ queue: QueueName; jobName: string; jobId?: string }> = [];

    while (testQueuedJobs.length > 0 && processed.length < maxJobs) {
        const message = testQueuedJobs.shift();
        if (!message) break;

        const processor = processors.get(message.queue);
        if (!processor) {
            throw new Error(`No test processor registered for queue ${message.queue}`);
        }

        await processor(createQueueJob(message.data));
        processed.push({
            queue: message.queue,
            jobName: message.jobName,
            jobId: message.jobId,
        });
    }

    return {
        processed,
        remaining: testQueuedJobs.length,
    };
};

export const queues = {
    ingest: new AppQueue<any>('ingest'),
    enrichment: new AppQueue<any>('enrichment'),
    embedding: new AppQueue<any>('embedding'),
    clustering: new AppQueue<any>('clustering'),
};
