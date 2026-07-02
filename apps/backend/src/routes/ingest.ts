import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { beginUserPipelineRun, markUserCancelled } from '../lib/cancellation';
import { normalizeClusteringSettings } from '../lib/clusteringSettings';
import { recordPipelineRunStarted } from '../lib/pipelineCoordinator';
import { queues } from '../lib/queue';
import {
    ensureUserExists,
    FREE_TIER_LIMIT,
    getUserPremiumStatus,
    requireRequestUserId
} from '../lib/userContext';
import {
    authenticatedStatusResponseSchema,
    errorResponseSchema,
    looseObjectBodySchema,
    statusOkResponseSchema,
    userIdParamsSchema
} from './schemas';

type IngestBody = {
    bookmarks?: any[];
    clusteringSettings?: unknown;
};

type ConfirmApplyBody = {
    folderChromeIds?: Array<{ clusterId?: unknown; chromeFolderId?: unknown }>;
};

export const registerIngestRoutes = async (fastify: FastifyInstance) => {
    fastify.post(
        '/ingest',
        {
            schema: {
                body: looseObjectBodySchema,
                response: {
                    ...statusOkResponseSchema,
                    401: errorResponseSchema,
                    402: errorResponseSchema,
                    500: errorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const body = req.body as IngestBody;
            const { bookmarks, clusteringSettings: rawClusteringSettings } =
                body;
            const clusteringSettings = normalizeClusteringSettings(
                rawClusteringSettings
            );
            console.log(
                `[INGEST] Received ${bookmarks?.length ?? 0} bookmarks for user ${userId} (density=${clusteringSettings.folderDensity}, tone=${clusteringSettings.namingTone}, emoji=${clusteringSettings.useEmojiNames})`
            );
            const userError = await ensureUserExists(userId);
            if (userError) {
                console.error(
                    '[INGEST] Failed to ensure user exists:',
                    userError
                );
                return reply
                    .code(500)
                    .send({ error: 'Failed to initialize user' });
            }
            const isPremium = await getUserPremiumStatus(userId);

            if (!isPremium) {
                const incomingCount = bookmarks?.length ?? 0;

                if (incomingCount > FREE_TIER_LIMIT) {
                    console.log(
                        `[INGEST] User ${userId} exceeded free tier limit: incoming ${incomingCount} > ${FREE_TIER_LIMIT}`
                    );
                    return reply.code(402).send({
                        error: 'Bookmark limit exceeded',
                        message: `Free tier allows up to ${FREE_TIER_LIMIT} bookmarks stored in Link Loom. Import clears your existing bookmarks first, leaving 0 before import; this Chrome import contains ${incomingCount}.`,
                        limit: FREE_TIER_LIMIT,
                        current: 0,
                        attempted: incomingCount,
                        upgradeUrl: '/dashboard/billing'
                    });
                }
            }

            let pipelineRun;
            try {
                pipelineRun = await beginUserPipelineRun(userId);
                await recordPipelineRunStarted(
                    userId,
                    pipelineRun.generation,
                    bookmarks?.length ?? 0,
                    clusteringSettings
                );
            } catch (error) {
                console.error(
                    `[INGEST] Failed to initialize pipeline run for user ${userId}`,
                    error
                );
                return reply
                    .code(500)
                    .send({ error: 'Failed to initialize ingest run' });
            }

            await queues.ingest.add(
                'ingest',
                {
                    userId,
                    bookmarks,
                    clusteringSettings,
                    pipelineRunId: pipelineRun.id
                },
                {
                    jobId: `ingest-${userId}-run-${pipelineRun.id || pipelineRun.generation}`
                }
            );
            console.log(`[INGEST] Queued ingest job for user ${userId}`);
            return { status: 'queued' };
        }
    );

    fastify.post(
        '/trigger-clustering/:userId',
        {
            schema: {
                params: userIdParamsSchema,
                body: looseObjectBodySchema,
                response: authenticatedStatusResponseSchema
            }
        },
        async (req, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const body = req.body as { clusteringSettings?: unknown };
            const clusteringSettings = normalizeClusteringSettings(
                body?.clusteringSettings
            );
            const { count: bookmarkCount, error: bookmarkCountError } =
                await supabase
                    .from('bookmarks')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', userId);

            if (bookmarkCountError) {
                console.error(
                    `[MANUAL] Failed to count bookmarks for user ${userId}`,
                    bookmarkCountError
                );
                return reply
                    .code(500)
                    .send({ error: 'Failed to initialize clustering run' });
            }

            let pipelineRun;
            try {
                pipelineRun = await beginUserPipelineRun(userId);
                await recordPipelineRunStarted(
                    userId,
                    pipelineRun.generation,
                    bookmarkCount ?? 0,
                    clusteringSettings
                );
            } catch (error) {
                console.error(
                    `[MANUAL] Failed to initialize pipeline run for user ${userId}`,
                    error
                );
                return reply
                    .code(500)
                    .send({ error: 'Failed to initialize clustering run' });
            }

            console.log(`[MANUAL] Triggering clustering for user ${userId}`);
            await queues.clustering.add(
                'cluster',
                {
                    userId,
                    clusteringSettings,
                    pipelineRunId: pipelineRun.id
                },
                {
                    jobId: `cluster-${userId}-manual-run-${pipelineRun.id || pipelineRun.generation}`
                }
            );
            return { status: 'clustering_queued' };
        }
    );

    fastify.post(
        '/confirm-apply/:userId',
        {
            schema: {
                params: userIdParamsSchema,
                body: looseObjectBodySchema,
                response: authenticatedStatusResponseSchema
            }
        },
        async (req, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const body = req.body as ConfirmApplyBody;
            const pairs = (body.folderChromeIds ?? []).filter(
                (
                    pair
                ): pair is { clusterId: string; chromeFolderId: string } =>
                    typeof pair?.clusterId === 'string' &&
                    typeof pair?.chromeFolderId === 'string'
            );

            if (pairs.length === 0) {
                return { status: 'ok' };
            }

            const results = await Promise.all(
                pairs.map(({ clusterId, chromeFolderId }) =>
                    supabase
                        .from('clusters')
                        .update({ chrome_folder_id: chromeFolderId })
                        .eq('id', clusterId)
                        .eq('user_id', userId)
                )
            );

            const failed = results.filter((result) => result.error);
            if (failed.length > 0) {
                console.error(
                    `[CONFIRM-APPLY] Failed to record ${failed.length}/${pairs.length} folder mappings for user ${userId}`,
                    failed[0].error
                );
                return reply
                    .code(500)
                    .send({ error: 'Failed to record folder mappings' });
            }

            console.log(
                `[CONFIRM-APPLY] Recorded ${pairs.length} folder mapping(s) for user ${userId}`
            );
            return { status: 'ok' };
        }
    );

    fastify.post(
        '/cancel/:userId',
        {
            schema: {
                params: userIdParamsSchema,
                response: authenticatedStatusResponseSchema
            }
        },
        async (req, reply) => {
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
                console.error(
                    '[CANCEL] Failed to reset bookmark status',
                    updateError
                );
                return reply
                    .code(500)
                    .send({ error: 'Failed to reset status' });
            }

            return { status: 'cancelled' };
        }
    );
};
