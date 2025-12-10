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
import { supabase } from './db';
import OpenAI from 'openai';

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
            origin: true
        });

        startWorkers();

        // API Routes
        fastify.post('/ingest', async (req: any, reply) => {
            const { userId, bookmarks } = req.body;
            console.log(`[INGEST] Received ${bookmarks?.length ?? 0} bookmarks for user ${userId}`);
            await queues.ingest.add('ingest', { userId, bookmarks });
            console.log(`[INGEST] Queued ingest job for user ${userId}`);
            return { status: 'queued' };
        });

        fastify.get('/status/:userId', async (req: any, reply) => {
            const { userId } = req.params;

            // Count total bookmarks for this user
            const { count: totalCount } = await supabase
                .from('bookmarks')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            // Count pending bookmarks
            const { count: pendingCount } = await supabase
                .from('bookmarks')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('status', 'pending');

            // Count clusters
            const { count: clusterCount } = await supabase
                .from('clusters')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            console.log(`[STATUS] User ${userId}: total=${totalCount}, pending=${pendingCount}, clusters=${clusterCount}`);

            return {
                pending: pendingCount ?? 0,
                total: totalCount ?? 0,
                clusters: clusterCount ?? 0,
                isDone: (pendingCount ?? 0) === 0 && (clusterCount ?? 0) > 0
            };
        });

        fastify.get('/structure/:userId', async (req: any, reply) => {
            const { userId } = req.params;

            // Fetch clusters
            const { data: userClusters } = await supabase
                .from('clusters')
                .select('*')
                .eq('user_id', userId);

            // Fetch assignments with cluster info
            const { data: assignments } = await supabase
                .from('cluster_assignments')
                .select(`
                    cluster_id,
                    bookmark_id,
                    clusters!inner (user_id)
                `)
                .eq('clusters.user_id', userId);

            return { clusters: userClusters ?? [], assignments: assignments ?? [] };
        });

        fastify.post('/search', async (req: any, reply) => {
            const { userId, query } = req.body;

            // 1. Embed Query
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: query,
            });
            const queryVector = response.data[0].embedding;

            // 2. Semantic Search using Supabase RPC (vector similarity)
            // This requires a database function for vector search
            const { data: results } = await supabase.rpc('search_bookmarks', {
                query_vector: queryVector,
                user_id: userId,
                match_count: 20
            });

            return { results: results ?? [] };
        });

        await fastify.listen({ port: 3333, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
