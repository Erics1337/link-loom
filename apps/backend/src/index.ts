import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as dotenv from 'dotenv';

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
    createWorker('enrichment', enrichmentProcessor, { concurrency: 50 });
    createWorker('embedding', embeddingProcessor, { concurrency: 20 });
    createWorker('clustering', clusteringProcessor);
    console.log('Workers started with optimized concurrency (Enrichment: 50, Embedding: 20)');
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

            // Premium Tier Enforcement - Check if user is over limit
            const { data: user } = await supabase
                .from('users')
                .select('is_premium')
                .eq('id', userId)
                .single();

            const isPremium = user?.is_premium ?? false;
            const FREE_TIER_LIMIT = 500;

            if (!isPremium) {
                // Count existing bookmarks
                const { count: existingCount } = await supabase
                    .from('bookmarks')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId);

                const totalAfterIngest = (existingCount ?? 0) + (bookmarks?.length ?? 0);

                if (totalAfterIngest > FREE_TIER_LIMIT) {
                    console.log(`[INGEST] User ${userId} exceeded free tier limit: ${totalAfterIngest}/${FREE_TIER_LIMIT}`);
                    return reply.code(402).send({
                        error: 'Bookmark limit exceeded',
                        message: `Free tier is limited to ${FREE_TIER_LIMIT} bookmarks. You have ${existingCount ?? 0} and tried to add ${bookmarks?.length ?? 0}.`,
                        limit: FREE_TIER_LIMIT,
                        current: existingCount ?? 0,
                        attempted: bookmarks?.length ?? 0,
                        upgradeUrl: '/dashboard/billing'
                    });
                }
            }

            // Clear previous clusters to prevent race condition where /status reports "Done" due to old data
            const { error: deleteError } = await supabase
                .from('clusters')
                .delete()
                .eq('user_id', userId);
            
            if (deleteError) {
                console.warn(`[INGEST] Warning: Failed to clear old clusters for user ${userId}`, deleteError);
            } else {
                console.log(`[INGEST] Cleared old clusters for user ${userId}`);
            }

            await queues.ingest.add('ingest', { userId, bookmarks });
            console.log(`[INGEST] Queued ingest job for user ${userId}`);
            return { status: 'queued' };
        });

        // Device Registration
        fastify.post('/register-device', async (req: any, reply) => {
            const { userId, deviceId, name } = req.body;
            
            // 1. Check current device count
            const { count, error: countError } = await supabase
                .from('user_devices')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);
            
            if (countError) {
                console.error('[Device] Count error:', countError);
                return reply.code(500).send({ error: 'Database error' });
            }

            // 2. Register if under limit or already exists
            // Upsert doesn't quite work for "limit check" on insert unless we rely on db constraint trigger or check manually.
            // We'll check manually here for simplicity.
            
            // Check if this device already exists
            const { data: existing } = await supabase
                .from('user_devices')
                .select('id')
                .eq('user_id', userId)
                .eq('device_id', deviceId)
                .single();

            if (existing) {
                // Update last_seen
                await supabase.from('user_devices').update({ last_seen_at: new Date() }).eq('id', existing.id);
                return { status: 'registered' };
            }

            if ((count ?? 0) >= 3) {
                return reply.code(403).send({ error: 'Device limit reached. Please manage devices in dashboard.' });
            }

            const { error: insertError } = await supabase.from('user_devices').insert({
                user_id: userId,
                device_id: deviceId,
                name: name || 'Unknown Device'
            });

            if (insertError) {
                 console.error('[Device] Insert error:', insertError);
                 return reply.code(500).send({ error: 'Failed to register device' });
            }

            return { status: 'registered' };
        });

        fastify.get('/status/:userId', async (req: any, reply) => {
            const { userId } = req.params;

            // Get User Premium Status
            const { data: user } = await supabase
                .from('users')
                .select('is_premium')
                .eq('id', userId)
                .single();
            
            const isPremium = user?.is_premium ?? false;

            // Count total bookmarks for this user
            const { count: totalCount, error: totalError } = await supabase
                .from('bookmarks')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            if (totalError) console.error('[STATUS] Total Count Error:', totalError);

            // Count in-progress bookmarks (pending or enriched - not yet embedded)
            const { count: pendingCount, error: pendingError } = await supabase
                .from('bookmarks')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .in('status', ['pending', 'enriched']);

            if (pendingError) console.error('[STATUS] Pending Count Error:', pendingError);

            // Count clusters
            const { count: clusterCount, error: clusterError } = await supabase
                .from('clusters')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            // Count bookmarks assigned to clusters
            // We join with clusters to filter by user_id
            const { count: assignedCount, error: assignedError } = await supabase
                .from('cluster_assignments')
                .select('bookmark_id', { count: 'exact', head: true })
                .eq('clusters.user_id', userId) // This requires a join if not checking clusters specifically
                // Actually, cluster_assignments doesn't have user_id. We need to join.
                // However, doing a join in a count/head query might be tricky in simple syntax.
                // An alternative is: We know the user's clusters.
                // But a more robust way is to just trust that we cleaned up old clusters or assume all assigns for user's clusters.
                // Let's use the foreign key link if PostgREST supports it easily, or just count 'clusters' which we have.
                // Wait, the client wants to know "how many bookmarks have been clustered".
                // We can query: SELECT count(distinct bookmark_id) FROM cluster_assignments JOIN clusters ON ...
                // Supabase syntax:
               .not('bookmark_id', 'is', null); 
               
            // To properly filter by user, we need to join clusters.
            // Let's retry:
            const { count: realAssignedCount, error: realAssignedError } = await supabase
               .from('cluster_assignments')
               .select('*, clusters!inner(user_id)', { count: 'exact', head: true })
               .eq('clusters.user_id', userId);

            if (realAssignedError) console.error('[STATUS] Assigned Count Error:', realAssignedError);

            // Check actual queue status to ensure we don't say "Done" while clustering is still running
            const clusteringCounts = await queues.clustering.getJobCounts('active', 'waiting', 'delayed');
            const isClusteringActive = clusteringCounts.active > 0 || clusteringCounts.waiting > 0 || clusteringCounts.delayed > 0;

            console.log(`[STATUS] User ${userId}: total=${totalCount}, pending=${pendingCount}, assigned=${realAssignedCount}, clusters=${clusterCount}, clusteringActive=${isClusteringActive}`);

            return {
                pending: pendingCount ?? 0,
                total: totalCount ?? 0,
                clusters: clusterCount ?? 0,
                assigned: realAssignedCount ?? 0,
                isDone: (pendingCount ?? 0) === 0 && (clusterCount ?? 0) > 0 && !isClusteringActive,
                isPremium, // Return premium status
            };
        });

        fastify.get('/structure/:userId', async (req: any, reply) => {
            const { userId } = req.params;

            // Fetch clusters
            const { data: userClusters } = await supabase
                .from('clusters')
                .select('*')
                .eq('user_id', userId);

            // Fetch assignments with cluster info and chrome_id for Apply Changes
            const { data: assignments } = await supabase
                .from('cluster_assignments')
                .select(`
                    cluster_id,
                    bookmark_id,
                    clusters!inner (user_id),
                    bookmarks (title, url, chrome_id)
                `)
                .eq('clusters.user_id', userId);

            return { clusters: userClusters ?? [], assignments: assignments ?? [] };
        });

        // Manual trigger for clustering (for recovery)
        fastify.post('/trigger-clustering/:userId', async (req: any, reply) => {
            const { userId } = req.params;
            console.log(`[MANUAL] Triggering clustering for user ${userId}`);
            await queues.clustering.add('cluster', { userId }, { 
                jobId: `cluster-${userId}-manual-${Date.now()}`
            });
            return { status: 'clustering_queued' };
        });

        fastify.post('/cancel/:userId', async (req: any, reply) => {
            const { userId } = req.params;
            console.log(`[CANCEL] Request received for user ${userId}`);

            // 1. Clear Jobs from Queues
            const queueNames = ['ingest', 'enrichment', 'embedding', 'clustering'] as const;
            let removedCount = 0;

            for (const name of queueNames) {
                const queue = queues[name];
                const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
                
                for (const job of jobs) {
                    if (job.data.userId === userId) {
                        try {
                            // If active, we might need to discard it differently or dependencies
                            await job.remove();
                            removedCount++;
                        } catch (e) {
                            console.error(`[CANCEL] Failed to remove job ${job.id} from ${name}`, e);
                        }
                    }
                }
            }
            console.log(`[CANCEL] Removed ${removedCount} jobs for user ${userId}`);

            // 2. Reset Database Status
            // We want to stop them from being "in progress". 
            // Setting to 'idle' allows them to be picked up again later if user retries.
            // We only reset those that are NOT 'done' (though 'done' isn't a status, 'clustered' might be?)
            // Statuses: 'pending', 'scraped', 'enriched', 'embedded', 'clustered'
            // If we cancel, we probably want to reset anything not fully 'clustered' back to start?
            // Or maybe just leave them? If we leave them, the status check might still think we are busy if it counts 'pending'.
            // The status check counts: .in('status', ['pending', 'enriched'])
            // So we must change 'pending' and 'enriched' to something else or delete them?
            // "Resetting" implies we want to forget progress. 'idle' seems appropriate if we want to restart.
            // But if we just want to stop, maybe we leave them as is?
            // If we leave them as 'pending', the frontend will still show "Processing..." next time it loads.
            // So we MUST clear the 'pending' state.
            
            const { error: updateError } = await supabase
                .from('bookmarks')
                .update({ status: 'idle' }) // Assume 'idle' or null is the initial state? Table definition would confirm. Let's assume 'idle'.
                .eq('user_id', userId)
                .in('status', ['pending', 'enriched']);

            if (updateError) {
                console.error('[CANCEL] Failed to reset bookmark status', updateError);
                return reply.code(500).send({ error: 'Failed to reset status' });
            }

            // Also clear any clusters if we want a full reset? 
            // Maybe not. Just stop processing.

            return { status: 'cancelled', jobsRemoved: removedCount };
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
