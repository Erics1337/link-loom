import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { beginUserPipelineRun, markUserCancelled } from '../lib/cancellation';
import { normalizeClusteringSettings } from '../lib/clusteringSettings';
import { queues } from '../lib/queue';
import {
    ensureUserExists,
    FREE_TIER_LIMIT,
    getUserPremiumStatus,
    requireRequestUserId,
} from '../lib/userContext';
import { errorResponseSchema, looseObjectBodySchema, userIdParamsSchema } from './schemas';

type IngestBody = {
    bookmarks?: any[];
    clusteringSettings?: unknown;
};

export const registerIngestRoutes = async (fastify: FastifyInstance) => {
    fastify.post('/ingest', {
        schema: {
            body: looseObjectBodySchema,
            response: {
                200: {
                    type: 'object',
                    required: ['status'],
                    properties: {
                        status: { type: 'string' },
                    },
                },
                401: errorResponseSchema,
                402: errorResponseSchema,
                500: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        const body = req.body as IngestBody;
        const { bookmarks, clusteringSettings: rawClusteringSettings } = body;
        const clusteringSettings = normalizeClusteringSettings(rawClusteringSettings);
        console.log(
            `[INGEST] Received ${bookmarks?.length ?? 0} bookmarks for user ${userId} (density=${clusteringSettings.folderDensity}, tone=${clusteringSettings.namingTone}, mode=${clusteringSettings.organizationMode}, emoji=${clusteringSettings.useEmojiNames})`
        );
        const userError = await ensureUserExists(userId);
        if (userError) {
            console.error('[INGEST] Failed to ensure user exists:', userError);
            return reply.code(500).send({ error: 'Failed to initialize user' });
        }
        const jobGeneration = await beginUserPipelineRun(userId);

        const isPremium = await getUserPremiumStatus(userId);

        if (!isPremium) {
            const incomingCount = bookmarks?.length ?? 0;

            if (incomingCount > FREE_TIER_LIMIT) {
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

        const { error: deleteBookmarksError } = await supabase
            .from('bookmarks')
            .delete()
            .eq('user_id', userId);

        if (deleteBookmarksError) {
            console.error(`[INGEST] Failed to clear old bookmarks for user ${userId}`, deleteBookmarksError);
            return reply.code(500).send({ error: 'Failed to clear existing bookmarks' });
        }

        const { error: deleteError } = await supabase
            .from('clusters')
            .delete()
            .eq('user_id', userId);

        if (deleteError) {
            console.error(`[INGEST] Failed to clear old clusters for user ${userId}`, deleteError);
            return reply.code(500).send({ error: 'Failed to clear existing clusters' });
        }

        console.log(`[INGEST] Cleared old clusters for user ${userId}`);

        await queues.ingest.add('ingest', { userId, bookmarks, clusteringSettings, jobGeneration }, {
            jobId: `ingest-${userId}-generation-${jobGeneration}`,
        });
        console.log(`[INGEST] Queued ingest job for user ${userId}`);
        return { status: 'queued' };
    });

    fastify.post('/trigger-clustering/:userId', {
        schema: {
            params: userIdParamsSchema,
            body: looseObjectBodySchema,
            response: {
                200: {
                    type: 'object',
                    required: ['status'],
                    properties: {
                        status: { type: 'string' },
                    },
                },
                401: errorResponseSchema,
                403: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        const body = req.body as { clusteringSettings?: unknown };
        const clusteringSettings = normalizeClusteringSettings(body?.clusteringSettings);
        const jobGeneration = await beginUserPipelineRun(userId);
        console.log(`[MANUAL] Triggering clustering for user ${userId}`);
        await queues.clustering.add('cluster', { userId, clusteringSettings, jobGeneration }, {
            jobId: `cluster-${userId}-manual-generation-${jobGeneration}`
        });
        return { status: 'clustering_queued' };
    });

    fastify.post('/cancel/:userId', {
        schema: {
            params: userIdParamsSchema,
            response: {
                200: {
                    type: 'object',
                    required: ['status'],
                    properties: {
                        status: { type: 'string' },
                    },
                },
                401: errorResponseSchema,
                403: errorResponseSchema,
                500: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        console.log(`[CANCEL] Request received for user ${userId}`);
        await markUserCancelled(userId);

        const { error: updateError } = await supabase
            .from('bookmarks')
            .update({ status: 'idle' })
            .eq('user_id', userId)
            .in('status', ['pending', 'enriched']);

        if (updateError) {
            console.error('[CANCEL] Failed to reset bookmark status', updateError);
            return reply.code(500).send({ error: 'Failed to reset status' });
        }

        return { status: 'cancelled' };
    });
};
