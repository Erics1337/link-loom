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
import { markUserCancelled, clearUserCancelled } from './lib/cancellation';
import { normalizeClusteringSettings } from './lib/clusteringSettings';
import pLimit from 'p-limit';
import { generateBookmarkRename } from './lib/bookmarkRename';

const DEFAULT_FREE_TIER_LIMIT = 500;
const parsedFreeTierLimit = Number.parseInt(process.env.FREE_TIER_LIMIT ?? `${DEFAULT_FREE_TIER_LIMIT}`, 10);
const FREE_TIER_LIMIT = Number.isNaN(parsedFreeTierLimit) ? DEFAULT_FREE_TIER_LIMIT : parsedFreeTierLimit;
const SUPABASE_PAGE_SIZE = 1000;
const DEAD_LINK_TIMEOUT_MS = 4500;
const DEAD_LINK_STATUSES = new Set([404, 410, 451]);
const FALLBACK_TO_GET_STATUSES = new Set([405, 501]);
const DEAD_LINK_NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

const fetchAllPages = async <T>(
    fetchPage: (from: number, to: number) => any
) => {
    const allRows: T[] = [];
    let from = 0;

    while (true) {
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const { data, error } = await fetchPage(from, to);

        if (error) throw error;

        const rows = data ?? [];
        allRows.push(...rows);

        if (rows.length < SUPABASE_PAGE_SIZE) break;
        from += SUPABASE_PAGE_SIZE;
    }

    return allRows;
};

const fetchWithTimeout = async (url: string, method: 'HEAD' | 'GET') => {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(`Request timed out after ${DEAD_LINK_TIMEOUT_MS}ms`));
        }, DEAD_LINK_TIMEOUT_MS);
    });
    try {
        const headers = method === 'GET' ? { Range: 'bytes=0-0' } : undefined;
        const requestPromise = fetch(url, {
            method,
            redirect: 'follow',
            signal: controller.signal,
            headers
        });

        return await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
        controller.abort();
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
};

const isDeadBookmarkUrl = async (rawUrl: string) => {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return true;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        return false;
    }

    try {
        const headResponse = await fetchWithTimeout(url.toString(), 'HEAD');
        if (FALLBACK_TO_GET_STATUSES.has(headResponse.status)) {
            const getResponse = await fetchWithTimeout(url.toString(), 'GET');
            return DEAD_LINK_STATUSES.has(getResponse.status);
        }
        return DEAD_LINK_STATUSES.has(headResponse.status);
    } catch (error: any) {
        const code = error?.cause?.code ?? error?.code;
        if (code && DEAD_LINK_NETWORK_CODES.has(String(code))) {
            return true;
        }
        return false;
    }
};

const startWorkers = () => {
    createWorker('ingest', ingestProcessor);
    createWorker('enrichment', enrichmentProcessor, { concurrency: 50 });
    createWorker('embedding', embeddingProcessor, { concurrency: 20 });
    createWorker('clustering', clusteringProcessor);
    console.log('Workers started with optimized concurrency (Enrichment: 50, Embedding: 20)');
};

const ensureUserExists = async (userId: string) => {
    const { error } = await supabase
        .from('users')
        .upsert({ id: userId }, { onConflict: 'id' });

    return error;
};

const start = async () => {
    try {
        await fastify.register(cors, {
            origin: true
        });

        startWorkers();
        console.log(`[CONFIG] FREE_TIER_LIMIT=${FREE_TIER_LIMIT}`);

        // API Routes
        fastify.post('/ingest', async (req: any, reply) => {
            const { userId, bookmarks, clusteringSettings: rawClusteringSettings } = req.body;
            const clusteringSettings = normalizeClusteringSettings(rawClusteringSettings);
            console.log(
                `[INGEST] Received ${bookmarks?.length ?? 0} bookmarks for user ${userId} (density=${clusteringSettings.folderDensity}, tone=${clusteringSettings.namingTone}, mode=${clusteringSettings.organizationMode}, emoji=${clusteringSettings.useEmojiNames})`
            );
            clearUserCancelled(userId);

            const userError = await ensureUserExists(userId);
            if (userError) {
                console.error('[INGEST] Failed to ensure user exists:', userError);
                return reply.code(500).send({ error: 'Failed to initialize user' });
            }

            // Premium Tier Enforcement - Check if user is over limit
            const { data: user } = await supabase
                .from('users')
                .select('is_premium')
                .eq('id', userId)
                .maybeSingle();

            const isPremium = user?.is_premium ?? false;

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
                        message: `Free tier allows up to ${FREE_TIER_LIMIT} bookmarks stored in Link Loom. You currently have ${existingCount ?? 0} stored, and this Chrome import contains ${bookmarks?.length ?? 0}.`,
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

            await queues.ingest.add('ingest', { userId, bookmarks, clusteringSettings });
            console.log(`[INGEST] Queued ingest job for user ${userId}`);
            return { status: 'queued' };
        });

        // Device Registration
        fastify.post('/register-device', async (req: any, reply) => {
            const { userId, deviceId, name } = req.body;

            const userError = await ensureUserExists(userId);
            if (userError) {
                console.error('[Device] Failed to ensure user exists:', userError);
                return reply.code(500).send({ error: 'Failed to initialize user' });
            }
            
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
                .maybeSingle();

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

            // Get user and bookmark status counts in parallel for richer stage reporting.
            const [
                { data: user },
                { count: totalCount, error: totalError },
                { count: pendingRawCount, error: pendingRawError },
                { count: enrichedCount, error: enrichedError },
                { count: embeddedCount, error: embeddedError },
                { count: erroredCount, error: erroredError },
                { count: clusterCount, error: clusterError },
                { count: assignedCount, error: assignmentError }
            ] = await Promise.all([
                supabase
                    .from('users')
                    .select('is_premium')
                    .eq('id', userId)
                    .maybeSingle(),
                supabase
                    .from('bookmarks')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId),
                supabase
                    .from('bookmarks')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId)
                    .eq('status', 'pending'),
                supabase
                    .from('bookmarks')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId)
                    .eq('status', 'enriched'),
                supabase
                    .from('bookmarks')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId)
                    .eq('status', 'embedded'),
                supabase
                    .from('bookmarks')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId)
                    .eq('status', 'error'),
                supabase
                    .from('clusters')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId),
                supabase
                    .from('cluster_assignments')
                    .select('bookmark_id, clusters!inner(user_id)', { count: 'exact', head: true })
                    .eq('clusters.user_id', userId)
            ]);

            const isPremium = user?.is_premium ?? false;

            if (totalError) console.error('[STATUS] Total Count Error:', totalError);
            if (pendingRawError) console.error('[STATUS] Pending Raw Count Error:', pendingRawError);
            if (enrichedError) console.error('[STATUS] Enriched Count Error:', enrichedError);
            if (embeddedError) console.error('[STATUS] Embedded Count Error:', embeddedError);
            if (erroredError) console.error('[STATUS] Errored Count Error:', erroredError);
            if (clusterError) console.error('[STATUS] Cluster Count Error:', clusterError);

            if (assignmentError) console.error('[STATUS] Assigned Count Error:', assignmentError);
            // Each bookmark is assigned once, so an exact count is enough and avoids returning all rows.
            const distinctAssignedCount = assignedCount ?? 0;
            const processingCount = (pendingRawCount ?? 0) + (enrichedCount ?? 0);
            const remainingToAssign = Math.max((embeddedCount ?? 0) - distinctAssignedCount, 0);

            // Ingest progress for current user (helps frontend show realistic progress when cache hits dominate).
            const ingestJobs = await queues.ingest.getJobs(['active', 'waiting', 'delayed']);
            const userIngestJob = ingestJobs.find((job: any) => job.data?.userId === userId);
            const isIngesting = Boolean(userIngestJob);
            let ingestProcessed = 0;
            let ingestTotal = totalCount ?? 0;

            if (userIngestJob) {
                const progress = userIngestJob.progress as any;
                if (typeof progress === 'number') {
                    ingestProcessed = progress;
                } else if (progress && typeof progress === 'object') {
                    ingestProcessed = Number(progress.processed) || 0;
                    ingestTotal = Number(progress.total) || ingestTotal;
                }
            }

            // Check actual queue status to ensure we don't say "Done" while clustering is still running
            const clusteringCounts = await queues.clustering.getJobCounts('active', 'waiting', 'delayed');
            const isClusteringActive = clusteringCounts.active > 0 || clusteringCounts.waiting > 0 || clusteringCounts.delayed > 0;

            console.log(
                `[STATUS] User ${userId}: total=${totalCount}, pending=${pendingRawCount ?? 0}, enriched=${enrichedCount ?? 0}, embedded=${embeddedCount ?? 0}, errored=${erroredCount ?? 0}, assigned=${distinctAssignedCount}, clusters=${clusterCount}, ingesting=${isIngesting}, ingestProcessed=${ingestProcessed}/${ingestTotal}, clusteringActive=${isClusteringActive}`
            );

            const isDone =
                processingCount === 0 &&
                (clusterCount ?? 0) > 0 &&
                !isClusteringActive &&
                remainingToAssign === 0;

            return {
                pending: processingCount,
                pendingRaw: pendingRawCount ?? 0,
                enriched: enrichedCount ?? 0,
                embedded: embeddedCount ?? 0,
                errored: erroredCount ?? 0,
                processing: processingCount,
                remainingToAssign,
                total: totalCount ?? 0,
                clusters: clusterCount ?? 0,
                assigned: distinctAssignedCount,
                isIngesting,
                ingestProcessed,
                ingestTotal,
                isClusteringActive,
                isDone,
                isPremium, // Return premium status
            };
        });

        fastify.get('/structure/:userId', async (req: any, reply) => {
            const { userId } = req.params;

            try {
                const userClusters = await fetchAllPages<any>((from, to) =>
                    supabase
                        .from('clusters')
                        .select('*')
                        .eq('user_id', userId)
                        .order('id', { ascending: true })
                        .range(from, to)
                );

                const assignments = await fetchAllPages<any>((from, to) =>
                    supabase
                        .from('cluster_assignments')
                        .select(`
                            cluster_id,
                            bookmark_id,
                            clusters!inner (user_id),
                            bookmarks (title, ai_title, description, url, chrome_id)
                        `)
                        .eq('clusters.user_id', userId)
                        .order('cluster_id', { ascending: true })
                        .order('bookmark_id', { ascending: true })
                        .range(from, to)
                );

                return { clusters: userClusters, assignments };
            } catch (error) {
                console.error('[STRUCTURE] Failed to load paged structure', error);
                return reply.code(500).send({ error: 'Failed to load structure' });
            }
        });

        fastify.post('/dead-links/check', async (req: any, reply) => {
            const rawBookmarks = Array.isArray(req.body?.bookmarks) ? req.body.bookmarks : [];
            const bookmarks = rawBookmarks
                .map((item: any) => ({
                    chromeId: typeof item?.chromeId === 'string' ? item.chromeId : '',
                    url: typeof item?.url === 'string' ? item.url : ''
                }))
                .filter((item: any) => item.chromeId && item.url);

            if (bookmarks.length === 0) {
                return { scanned: 0, dead: 0, deadChromeIds: [] };
            }

            // Check each unique URL once, then fan out to matching bookmark IDs.
            const chromeIdsByUrl = new Map<string, string[]>();
            for (const bookmark of bookmarks) {
                const key = bookmark.url.trim();
                if (!key) continue;
                const existing = chromeIdsByUrl.get(key);
                if (existing) {
                    existing.push(bookmark.chromeId);
                } else {
                    chromeIdsByUrl.set(key, [bookmark.chromeId]);
                }
            }

            const deadUrlSet = new Set<string>();
            const deadLinkCheckLimit = pLimit(25);

            await Promise.all(
                Array.from(chromeIdsByUrl.keys()).map((url) =>
                    deadLinkCheckLimit(async () => {
                        const isDead = await isDeadBookmarkUrl(url);
                        if (isDead) deadUrlSet.add(url);
                    })
                )
            );

            const deadChromeIds = Array.from(deadUrlSet).flatMap((url) => chromeIdsByUrl.get(url) ?? []);
            return {
                scanned: chromeIdsByUrl.size,
                dead: deadChromeIds.length,
                deadChromeIds
            };
        });

        fastify.post('/auto-rename/:userId', async (req: any, reply) => {
            const { userId } = req.params;
            const clusteringSettings = normalizeClusteringSettings(req.body?.clusteringSettings);

            let assignments: any[] = [];
            try {
                assignments = await fetchAllPages<any>((from, to) =>
                    supabase
                        .from('cluster_assignments')
                        .select(`
                            bookmark_id,
                            clusters!inner (user_id, name),
                            bookmarks!inner (id, title, ai_title, description, url)
                        `)
                        .eq('clusters.user_id', userId)
                        .order('bookmark_id', { ascending: true })
                        .range(from, to)
                );
            } catch (assignmentError) {
                console.error('[AUTO_RENAME] Failed to load assignments', assignmentError);
                return reply.code(500).send({ error: 'Failed to load bookmarks for rename' });
            }

            const contextByBookmarkId = new Map<string, any>();
            for (const assignment of assignments ?? []) {
                const bookmark = Array.isArray(assignment.bookmarks)
                    ? assignment.bookmarks[0]
                    : assignment.bookmarks;
                const cluster = Array.isArray(assignment.clusters)
                    ? assignment.clusters[0]
                    : assignment.clusters;
                if (!bookmark?.id) continue;

                contextByBookmarkId.set(bookmark.id, {
                    bookmarkId: bookmark.id,
                    currentTitle: bookmark.title,
                    currentAiTitle: bookmark.ai_title,
                    description: bookmark.description,
                    url: bookmark.url,
                    clusterName: cluster?.name ?? null,
                });
            }

            const contexts = Array.from(contextByBookmarkId.values());
            if (contexts.length === 0) {
                return { renamed: 0, scanned: 0, updates: [] };
            }

            const renameLimit = pLimit(6);
            const updates: Array<{ bookmark_id: string; ai_title: string }> = [];
            const updateErrors: string[] = [];

            await Promise.all(
                contexts.map((context) =>
                    renameLimit(async () => {
                        const suggestedTitle = await generateBookmarkRename({
                            currentTitle: context.currentTitle,
                            description: context.description,
                            url: context.url,
                            clusterName: context.clusterName,
                            namingTone: clusteringSettings.namingTone,
                            useEmojiNames: clusteringSettings.useEmojiNames,
                        });

                        const currentTitle = (context.currentTitle || '').trim();
                        const currentAiTitle = (context.currentAiTitle || '').trim();
                        const normalizedSuggestion = (suggestedTitle || '').trim();

                        if (!normalizedSuggestion) return;
                        if (normalizedSuggestion === currentAiTitle) return;
                        if (normalizedSuggestion === currentTitle && !currentAiTitle) return;

                        const { error: updateError } = await supabase
                            .from('bookmarks')
                            .update({ ai_title: normalizedSuggestion })
                            .eq('id', context.bookmarkId);

                        if (updateError) {
                            updateErrors.push(context.bookmarkId);
                            return;
                        }

                        updates.push({ bookmark_id: context.bookmarkId, ai_title: normalizedSuggestion });
                    })
                )
            );

            return {
                renamed: updates.length,
                scanned: contexts.length,
                failed: updateErrors.length,
                updates,
            };
        });

        // Manual trigger for clustering (for recovery)
        fastify.post('/trigger-clustering/:userId', async (req: any, reply) => {
            const { userId } = req.params;
            const clusteringSettings = normalizeClusteringSettings(req.body?.clusteringSettings);
            clearUserCancelled(userId);
            console.log(`[MANUAL] Triggering clustering for user ${userId}`);
            await queues.clustering.add('cluster', { userId, clusteringSettings }, {
                jobId: `cluster-${userId}-manual-${Date.now()}`
            });
            return { status: 'clustering_queued' };
        });

        fastify.post('/cancel/:userId', async (req: any, reply) => {
            const { userId } = req.params;
            const clearAllQueues = Boolean(req.body?.clearAllQueues);
            console.log(`[CANCEL] Request received for user ${userId} (clearAllQueues=${clearAllQueues})`);
            markUserCancelled(userId);

            // 1. Clear Jobs from Queues
            const queueNames = ['ingest', 'enrichment', 'embedding', 'clustering'] as const;
            let removedCount = 0;
            let failedToRemove = 0;
            const jobStates = ['waiting', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children', 'completed', 'failed'] as any;

            for (const name of queueNames) {
                const queue = queues[name];
                const jobs = await queue.getJobs(jobStates);
                
                for (const job of jobs) {
                    const belongsToUser = job.data?.userId === userId;
                    if (clearAllQueues || belongsToUser) {
                        try {
                            await job.remove();
                            removedCount++;
                        } catch (e) {
                            console.error(`[CANCEL] Failed to remove job ${job.id} from ${name}`, e);
                            failedToRemove++;
                        }
                    }
                }

                if (clearAllQueues) {
                    await queue.clean(0, 10000, 'completed');
                    await queue.clean(0, 10000, 'failed');
                }
            }
            console.log(`[CANCEL] Removed ${removedCount} jobs for user ${userId} (failed=${failedToRemove})`);

            // 2. Reset in-flight bookmarks so /status no longer reports the user as processing.
            const { error: updateError } = await supabase
                .from('bookmarks')
                .update({ status: 'idle' })
                .eq('user_id', userId)
                .in('status', ['pending', 'enriched']);

            if (updateError) {
                console.error('[CANCEL] Failed to reset bookmark status', updateError);
                return reply.code(500).send({ error: 'Failed to reset status' });
            }

            return { status: 'cancelled', jobsRemoved: removedCount, failedToRemove, clearAllQueues };
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
