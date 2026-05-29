import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { fetchAllPages } from '../lib/supabasePages';
import { requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, userIdParamsSchema } from './schemas';

export const registerStructureRoutes = async (fastify: FastifyInstance) => {
    fastify.get('/structure/:userId', {
        schema: {
            params: userIdParamsSchema,
            response: {
                200: {
                    type: 'object',
                    required: ['clusters', 'assignments'],
                    properties: {
                        clusters: { type: 'array', items: { type: 'object', additionalProperties: true } },
                        assignments: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
};
