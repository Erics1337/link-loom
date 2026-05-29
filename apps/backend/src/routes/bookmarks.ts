import type { FastifyInstance } from 'fastify';

import { normalizeClusteringSettings } from '../lib/clusteringSettings';
import { queueManualBookmark } from '../lib/manualBookmark';
import {
    ensureUserExists,
    FREE_TIER_LIMIT,
    getUserPremiumStatus,
    requireRequestUserId,
} from '../lib/userContext';
import { errorResponseSchema, looseObjectBodySchema } from './schemas';

type AddBookmarkBody = {
    url?: unknown;
    title?: unknown;
    clusteringSettings?: unknown;
};

export const registerBookmarkRoutes = async (fastify: FastifyInstance) => {
    fastify.post('/bookmarks/add', {
        schema: {
            body: looseObjectBodySchema,
            response: {
                200: {
                    type: 'object',
                    required: ['status', 'chromeId'],
                    properties: {
                        status: { type: 'string' },
                        chromeId: { type: 'string' },
                    },
                },
                400: errorResponseSchema,
                401: errorResponseSchema,
                402: errorResponseSchema,
                500: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;

        const body = req.body as AddBookmarkBody;
        const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
        const title = typeof body?.title === 'string' && body.title.trim()
            ? body.title.trim()
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
            clusteringSettings: normalizeClusteringSettings(body?.clusteringSettings),
        });

        if (!result.ok) {
            return reply.code(result.statusCode).send(result.payload);
        }

        return { status: 'queued', chromeId: result.chromeId };
    });
};
