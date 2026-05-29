import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as dotenv from 'dotenv';

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
import { createLimit } from './lib/limit';
import { generateBookmarkRename } from './lib/bookmarkRename';
import { safeFetch } from './lib/safeFetch';
import { queueManualBookmark } from './lib/manualBookmark';

const DEFAULT_FREE_TIER_LIMIT = 500;
const parsedFreeTierLimit = Number.parseInt(process.env.FREE_TIER_LIMIT ?? `${DEFAULT_FREE_TIER_LIMIT}`, 10);
const FREE_TIER_LIMIT = Number.isNaN(parsedFreeTierLimit) ? DEFAULT_FREE_TIER_LIMIT : parsedFreeTierLimit;
const SUPABASE_PAGE_SIZE = 1000;
const DEAD_LINK_TIMEOUT_MS = 3000;
const DEAD_LINK_SCAN_DEADLINE_MS = 30_000;
const DEAD_LINK_STATUSES = new Set([404, 410, 451]);
const DEAD_LINK_NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);
const ALLOW_UNAUTHENTICATED_USER_ID =
    process.env.ALLOW_UNAUTHENTICATED_USER_ID === 'true' ||
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST);

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

const getUserPremiumStatus = async (userId: string) => {
    if (!userId) return false;

    const { data: user, error } = await supabase
        .from('users')
        .select('is_premium')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error(`[BILLING] Failed to load premium status for user ${userId}`, error);
    }

    return user?.is_premium ?? false;
};

const requirePremium = async (userId: string, reply: any) => {
    const isPremium = await getUserPremiumStatus(userId);
    if (isPremium) return true;

    reply.code(402).send({
        error: 'Premium required',
        message: 'This feature requires Link Loom Pro.',
        upgradeUrl: '/dashboard/billing'
    });
    return false;
};

const getBearerToken = (req: any) => {
    const header = req.headers?.authorization;
    if (typeof header !== 'string') return '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? '';
};

const getFallbackUserId = (req: any) => {
    const paramUserId = typeof req.params?.userId === 'string' ? req.params.userId : '';
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    return paramUserId || bodyUserId;
};

const requireRequestUserId = async (req: any, reply: any) => {
    const token = getBearerToken(req);
    const fallbackUserId = getFallbackUserId(req);

    if (token) {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user?.id) {
            reply.code(401).send({ error: 'Invalid or expired session.' });
            return null;
        }

        if (fallbackUserId && fallbackUserId !== data.user.id) {
            reply.code(403).send({ error: 'User id does not match authenticated session.' });
            return null;
        }

        return data.user.id;
    }

    if (ALLOW_UNAUTHENTICATED_USER_ID && fallbackUserId) {
        return fallbackUserId;
    }

    reply.code(401).send({ error: 'Authentication required.' });
    return null;
};

const fetchWithTimeout = async (url: string, method: 'HEAD' | 'GET') => {
    const headers = method === 'GET' ? { Range: 'bytes=0-0' } : undefined;
    return safeFetch(url, { method, headers, timeoutMs: DEAD_LINK_TIMEOUT_MS });
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
        const response = await fetchWithTimeout(url.toString(), 'HEAD');
        // Any response (even 405 "method not allowed") means the server is alive.
        // Only certain statuses indicate the *page* is gone.
        return DEAD_LINK_STATUSES.has(response.status);
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
    console.log('Inline queue workers registered');
};

const ensureUserExists = async (userId: string) => {
    const { error } = await supabase
        .from('users')
        .upsert({ id: userId }, { onConflict: 'id' });

    return error;
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

        // API Routes
        fastify.post('/ingest', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const { bookmarks, clusteringSettings: rawClusteringSettings } = req.body;
            const clusteringSettings = normalizeClusteringSettings(rawClusteringSettings);
            console.log(
                `[INGEST] Received ${bookmarks?.length ?? 0} bookmarks for user ${userId} (density=${clusteringSettings.folderDensity}, tone=${clusteringSettings.namingTone}, mode=${clusteringSettings.organizationMode}, emoji=${clusteringSettings.useEmojiNames})`
            );
            await clearUserCancelled(userId);

            const userError = await ensureUserExists(userId);
            if (userError) {
                console.error('[INGEST] Failed to ensure user exists:', userError);
                return reply.code(500).send({ error: 'Failed to initialize user' });
            }

            // Premium Tier Enforcement - Check if user is over limit
            const isPremium = await getUserPremiumStatus(userId);

            if (!isPremium) {
                const incomingCount = bookmarks?.length ?? 0;

                if (incomingCount > FREE_TIER_LIMIT) {
                    // Count existing so we can give the user an informative message
                    const { count: existingCount } = await supabase
                        .from('bookmarks')
                        .select('*', { count: 'exact', head: true })
                        .eq('user_id', userId);

                    const currentCount = existingCount ?? 0;
                    console.log(`[INGEST] User ${userId} exceeded free tier limit: incoming ${incomingCount} > ${FREE_TIER_LIMIT}`);
                    return reply.code(402).send({
                        error: 'Bookmark limit exceeded',
                        message: `Free tier allows up to ${FREE_TIER_LIMIT} bookmarks stored in Link Loom. You currently have ${currentCount} stored, and this Chrome import contains ${incomingCount}.`,
                        limit: FREE_TIER_LIMIT,
                        current: currentCount,
                        attempted: incomingCount,
                        upgradeUrl: '/dashboard/billing'
                    });
                }
            }

            // Clear previous bookmarks so old ones don't artificially inflate the progress total
            const { error: deleteBookmarksError } = await supabase
                .from('bookmarks')
                .delete()
                .eq('user_id', userId);
            
            if (deleteBookmarksError) {
                console.warn(`[INGEST] Warning: Failed to clear old bookmarks for user ${userId}`, deleteBookmarksError);
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

        fastify.post('/bookmarks/add', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;

            const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
            const title = typeof req.body?.title === 'string' && req.body.title.trim()
                ? req.body.title.trim()
                : rawUrl;

            const userError = await ensureUserExists(userId);
            if (userError) {
                console.error('[BOOKMARKS] Failed to ensure user exists:', userError);
                return reply.code(500).send({ error: 'Failed to initialize user' });
            }

            const isPremium = await getUserPremiumStatus(userId);
            const result = await queueManualBookmark({
                userId,
                rawUrl,
                title,
                freeTierLimit: FREE_TIER_LIMIT,
                isPremium,
                clusteringSettings: req.body?.clusteringSettings,
            });

            if (!result.ok) {
                return reply.code(result.statusCode).send(result.payload);
            }

            return { status: 'queued', chromeId: result.chromeId };
        });

        // Device Registration
        fastify.post('/register-device', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const { deviceId, name } = req.body;

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
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;

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

            const isIngesting = (pendingRawCount ?? 0) > 0;
            const ingestProcessed = Math.max((totalCount ?? 0) - (pendingRawCount ?? 0), 0);
            const ingestTotal = totalCount ?? 0;
            const isClusteringActive = processingCount === 0 && (embeddedCount ?? 0) > 0 && (clusterCount ?? 0) === 0;

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
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;

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
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const hasPremium = await requirePremium(userId, reply);
            if (!hasPremium) return reply;

            const rawBookmarks = Array.isArray(req.body?.bookmarks) ? req.body.bookmarks : [];
            const bookmarks = rawBookmarks
                .map((item: any) => ({
                    chromeId: typeof item?.chromeId === 'string' ? item.chromeId : '',
                    url: typeof item?.url === 'string' ? item.url : ''
                }))
                .filter((item: any) => item.chromeId && item.url);

            if (bookmarks.length === 0) {
                return { scanned: 0, dead: 0, skipped: 0, deadChromeIds: [] };
            }

            // Deduplicate: check each unique URL once, then fan out to matching bookmark IDs.
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

            const uniqueUrls = Array.from(chromeIdsByUrl.keys());
            console.log(`[DEAD_LINKS] Checking ${uniqueUrls.length} unique URLs (from ${bookmarks.length} bookmarks)`);

            const deadUrlSet = new Set<string>();
            const deadLinkCheckLimit = createLimit(50);
            let deadlinePassed = false;
            let scannedCount = 0;

            // Set a hard deadline so we return partial results in a reasonable time.
            const deadlineTimer = setTimeout(() => {
                deadlinePassed = true;
            }, DEAD_LINK_SCAN_DEADLINE_MS);

            const promises = uniqueUrls.map((url) =>
                deadLinkCheckLimit(async () => {
                    // Skip URLs that haven't started checking yet if deadline passed.
                    if (deadlinePassed) return;
                    try {
                        const isDead = await isDeadBookmarkUrl(url);
                        if (isDead) deadUrlSet.add(url);
                    } catch {
                        // Swallow per-URL errors
                    }
                    scannedCount++;
                })
            );

            await Promise.all(promises);
            clearTimeout(deadlineTimer);

            const skipped = uniqueUrls.length - scannedCount;
            const deadChromeIds = Array.from(deadUrlSet).flatMap((url) => chromeIdsByUrl.get(url) ?? []);
            console.log(`[DEAD_LINKS] Done: scanned=${scannedCount}, dead=${deadChromeIds.length}, skipped=${skipped}`);
            return {
                scanned: scannedCount,
                dead: deadChromeIds.length,
                skipped,
                deadChromeIds
            };
        });

        fastify.post('/auto-rename/:userId', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const clusteringSettings = normalizeClusteringSettings(req.body?.clusteringSettings);
            const hasPremium = await requirePremium(userId, reply);
            if (!hasPremium) return reply;

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

            const renameLimit = createLimit(6);
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
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const clusteringSettings = normalizeClusteringSettings(req.body?.clusteringSettings);
            await clearUserCancelled(userId);
            console.log(`[MANUAL] Triggering clustering for user ${userId}`);
            await queues.clustering.add('cluster', { userId, clusteringSettings }, {
                jobId: `cluster-${userId}-manual-${Date.now()}`
            });
            return { status: 'clustering_queued' };
        });

        fastify.post('/cancel/:userId', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const clearAllQueues = Boolean(req.body?.clearAllQueues);
            console.log(`[CANCEL] Request received for user ${userId} (clearAllQueues=${clearAllQueues})`);
            await markUserCancelled(userId);

            // SQS messages already in flight cannot be selectively removed cheaply.
            // Reset DB state; processors also check the in-memory flag in local dev.
            const { error: updateError } = await supabase
                .from('bookmarks')
                .update({ status: 'idle' })
                .eq('user_id', userId)
                .in('status', ['pending', 'enriched']);

            if (updateError) {
                console.error('[CANCEL] Failed to reset bookmark status', updateError);
                return reply.code(500).send({ error: 'Failed to reset status' });
            }

            return { status: 'cancelled', jobsRemoved: 0, failedToRemove: 0, clearAllQueues };
        });

        fastify.get('/backups/:userId', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            try {
                // Fetch snapshots with counts
                const { data: snapshots, error } = await supabase
                    .from('structure_snapshots')
                    .select(`
                        id,
                        name,
                        created_at,
                        snapshot_clusters (
                            id,
                            snapshot_assignments (count)
                        )
                    `)
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });

                if (error) throw error;

                // Format to match expected extension type
                const formatted = (snapshots || []).map((s: any) => {
                    const folders = s.snapshot_clusters?.length || 0;
                    const bookmarks = s.snapshot_clusters?.reduce((acc: number, cluster: any) => {
                        return acc + (cluster.snapshot_assignments?.[0]?.count || 0);
                    }, 0) || 0;

                    return {
                        id: s.id,
                        name: s.name,
                        createdAt: s.created_at,
                        summary: { folders, bookmarks }
                    };
                });

                return { backups: formatted };
            } catch (err: any) {
                console.error('[BACKUPS] Fetch error:', err);
                return reply.code(500).send({ error: 'Failed to load backups' });
            }
        });

        fastify.post('/backups/:userId', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const { name } = req.body;
            try {
                const { data: snapshotId, error } = await supabase.rpc('create_structure_snapshot', {
                    p_user_id: userId,
                    p_snapshot_name: name || `Backup ${new Date().toLocaleDateString()}`
                });

                if (error) throw error;
                return { status: 'created', snapshotId };
            } catch (err: any) {
                console.error('[BACKUPS] Create error:', err);
                return reply.code(500).send({ error: 'Failed to create backup' });
            }
        });

        fastify.post('/backups/:userId/:snapshotId/restore', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const { snapshotId } = req.params;
            try {
                const { error } = await supabase.rpc('restore_structure_snapshot', {
                    p_user_id: userId,
                    p_snapshot_id: snapshotId
                });

                if (error) throw error;
                return { status: 'restored' };
            } catch (err: any) {
                console.error('[BACKUPS] Restore error:', err);
                return reply.code(500).send({ error: 'Failed to restore backup' });
            }
        });

        fastify.delete('/backups/:userId/:snapshotId', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const { snapshotId } = req.params;
            try {
                const { error } = await supabase
                    .from('structure_snapshots')
                    .delete()
                    .eq('id', snapshotId)
                    .eq('user_id', userId);

                if (error) throw error;
                return { status: 'deleted' };
            } catch (err: any) {
                console.error('[BACKUPS] Delete error:', err);
                return reply.code(500).send({ error: 'Failed to delete backup' });
            }
        });

        fastify.post('/search', async (req: any, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const { query } = req.body;

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
        await fastify.listen({ port: 3333, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

if (require.main === module) {
    start();
}
