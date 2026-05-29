import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, userIdParamsSchema } from './schemas';

export const registerStatusRoutes = async (fastify: FastifyInstance) => {
    fastify.get('/status/:userId', {
        schema: {
            params: userIdParamsSchema,
            response: {
                200: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'pending',
                        'pendingRaw',
                        'enriched',
                        'embedded',
                        'errored',
                        'processing',
                        'remainingToAssign',
                        'total',
                        'clusters',
                        'assigned',
                        'isIngesting',
                        'ingestProcessed',
                        'ingestTotal',
                        'isClusteringActive',
                        'isDone',
                        'isPremium',
                    ],
                    properties: {
                        pending: { type: 'number' },
                        pendingRaw: { type: 'number' },
                        enriched: { type: 'number' },
                        embedded: { type: 'number' },
                        errored: { type: 'number' },
                        processing: { type: 'number' },
                        remainingToAssign: { type: 'number' },
                        total: { type: 'number' },
                        clusters: { type: 'number' },
                        assigned: { type: 'number' },
                        isIngesting: { type: 'boolean' },
                        ingestProcessed: { type: 'number' },
                        ingestTotal: { type: 'number' },
                        isClusteringActive: { type: 'boolean' },
                        isDone: { type: 'boolean' },
                        isPremium: { type: 'boolean' },
                    },
                },
                401: errorResponseSchema,
                403: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;

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
            isPremium,
        };
    });
};
