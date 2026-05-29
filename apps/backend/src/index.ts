import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as dotenv from 'dotenv';

import { clearTestQueuedJobs, createWorker, drainTestQueuedJobs, getTestQueuedJobs } from './lib/queue';
import { ingestProcessor } from './queues/ingest';
import { enrichmentProcessor } from './queues/enrichment';
import { embeddingProcessor } from './queues/embedding';
import { clusteringProcessor } from './queues/clustering';
import { FREE_TIER_LIMIT } from './lib/userContext';
import { registerAuthRoutes } from './routes/auth';
import { registerBackupRoutes } from './routes/backups';
import { registerBookmarkRoutes } from './routes/bookmarks';
import { registerHealthRoutes } from './routes/health';
import { registerIngestRoutes } from './routes/ingest';
import { registerSearchRoutes } from './routes/search';
import { registerStatusRoutes } from './routes/status';
import { registerStructureRoutes } from './routes/structure';
import { registerToolRoutes } from './routes/tools';
import { supabase } from './db';

dotenv.config({ path: '.env.local' });
dotenv.config();

const fastify = Fastify({
    logger: {
        transport: {
            target: 'pino-pretty',
            options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
            },
        },
    }
});

let appReady = false;

const startWorkers = () => {
    createWorker('ingest', ingestProcessor);
    createWorker('enrichment', enrichmentProcessor, { concurrency: 50 });
    createWorker('embedding', embeddingProcessor, { concurrency: 20 });
    createWorker('clustering', clusteringProcessor);
    console.log('Inline queue workers registered');
};

export const buildApp = async () => {
    if (appReady) return fastify;
    appReady = true;

    try {
        await fastify.register(cors, {
            origin: true
        });

        if ((process.env.QUEUE_DRIVER ?? 'inline') !== 'sqs') {
            startWorkers();
        }
        console.log(`[CONFIG] FREE_TIER_LIMIT=${FREE_TIER_LIMIT}`);

        await registerHealthRoutes(fastify);
        await registerAuthRoutes(fastify);
        await registerBookmarkRoutes(fastify);
        await registerIngestRoutes(fastify);
        await registerStatusRoutes(fastify);
        await registerStructureRoutes(fastify);
        await registerToolRoutes(fastify);
        await registerBackupRoutes(fastify);
        await registerSearchRoutes(fastify);

        if (process.env.BACKEND_E2E_FAKE_SUPABASE === 'true') {
            fastify.get('/__e2e/queues', async () => ({ jobs: getTestQueuedJobs() }));
            fastify.post('/__e2e/queues/drain', async (req) => {
                const body = req.body as { maxJobs?: unknown } | undefined;
                const maxJobs = typeof body?.maxJobs === 'number'
                    ? Math.max(0, Math.min(Math.floor(body.maxJobs), 100))
                    : 50;
                return drainTestQueuedJobs(maxJobs);
            });
            fastify.get('/__e2e/bookmarks/:userId', async (req) => {
                const { userId } = req.params as { userId: string };
                const { data } = await supabase
                    .from('bookmarks')
                    .select('*')
                    .eq('user_id', userId);
                return { bookmarks: data ?? [] };
            });
            fastify.delete('/__e2e/queues', async () => {
                clearTestQueuedJobs();
                return { status: 'cleared' };
            });
        }

        return fastify;
    } catch (err) {
        fastify.log.error(err);
        appReady = false;
        throw err;
    }
};

const start = async () => {
    try {
        await buildApp();
        const port = Number.parseInt(process.env.PORT ?? '3333', 10);
        const host = process.env.HOST ?? '0.0.0.0';
        await fastify.listen({ port: Number.isNaN(port) ? 3333 : port, host });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

if (require.main === module) {
    start();
}
