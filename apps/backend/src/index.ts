import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as dotenv from 'dotenv';

dotenv.config();

const fastify = Fastify({
    logger: true
});



fastify.get('/health', async (request, reply) => {
    return { status: 'ok' };
});

import { createWorker } from './lib/queue';
import { ingestProcessor } from './queues/ingest';
import { enrichmentProcessor } from './queues/enrichment';
import { embeddingProcessor } from './queues/embedding';
import { clusteringProcessor } from './queues/clustering';

import { queues } from './lib/queue';
import { db } from './db';
import { bookmarks, clusters, clusterAssignments } from './db/schema';
import { eq, and } from 'drizzle-orm';

const startWorkers = () => {
    createWorker('ingest', ingestProcessor);
    createWorker('enrichment', enrichmentProcessor);
    createWorker('embedding', embeddingProcessor);
    createWorker('clustering', clusteringProcessor);
    console.log('Workers started');
};

const start = async () => {
    try {
        await fastify.register(cors, {
            origin: true // Allow all for now, lock down later
        });

        startWorkers();

        // API Routes
        fastify.post('/ingest', async (req: any, reply) => {
            const { userId, bookmarks } = req.body;
            await queues.ingest.add('ingest', { userId, bookmarks });
            return { status: 'queued' };
        });

        fastify.get('/status/:userId', async (req: any, reply) => {
            const { userId } = req.params;
            // Simple status check: count pending/processing items
            // In a real app, we'd have a more robust job tracking
            const pending = await db.select({ count: bookmarks.id }).from(bookmarks)
                .where(and(eq(bookmarks.userId, userId), eq(bookmarks.status, 'pending')));

            // Check if clustering is done (this is a simplification)
            const clusterCount = await db.select({ count: clusters.id }).from(clusters)
                .where(eq(clusters.userId, userId));

            return {
                pending: pending.length,
                clusters: clusterCount.length,
                isDone: pending.length === 0 && clusterCount.length > 0
            };
        });

        fastify.get('/structure/:userId', async (req: any, reply) => {
            const { userId } = req.params;
            // Fetch clusters and assignments
            const userClusters = await db.select().from(clusters).where(eq(clusters.userId, userId));
            const assignments = await db.select().from(clusterAssignments)
                .innerJoin(clusters, eq(clusterAssignments.clusterId, clusters.id))
                .where(eq(clusters.userId, userId));

            return { clusters: userClusters, assignments };
        });

        await fastify.listen({ port: 3333, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
