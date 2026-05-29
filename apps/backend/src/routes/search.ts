import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';

import { supabase } from '../db';
import { requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, looseObjectBodySchema } from './schemas';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

type SearchBody = {
    query?: unknown;
};

export const registerSearchRoutes = async (fastify: FastifyInstance) => {
    fastify.post('/search', {
        schema: {
            body: looseObjectBodySchema,
            response: {
                200: {
                    type: 'object',
                    required: ['results'],
                    properties: {
                        results: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    },
                },
                400: errorResponseSchema,
                401: errorResponseSchema,
                429: errorResponseSchema,
                500: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        const body = req.body as SearchBody;
        const trimmed = typeof body?.query === 'string' ? body.query.trim() : '';
        if (!trimmed) {
            return reply.code(400).send({ error: 'Query is required' });
        }
        const input = trimmed.substring(0, 8000);

        let queryVector: number[];
        try {
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input,
            });
            const embedding = response.data?.[0]?.embedding;
            if (!embedding) {
                fastify.log.error(
                    { queryLength: input.length },
                    '[SEARCH] OpenAI returned no embedding',
                );
                return reply.code(500).send({ error: 'Failed to generate search embedding' });
            }
            queryVector = embedding;
        } catch (err: unknown) {
            const status = err && typeof err === 'object' && 'status' in err
                ? (err as { status?: number }).status
                : undefined;
            fastify.log.error(
                { err, queryLength: input.length, status },
                '[SEARCH] Embedding request failed',
            );
            if (status === 429) {
                return reply.code(429).send({
                    error: 'Search is temporarily rate-limited. Please try again shortly.',
                });
            }
            return reply.code(500).send({ error: 'Failed to generate search embedding' });
        }

        try {
            const { data, error } = await supabase.rpc('search_bookmarks', {
                query_vector: queryVector,
                user_id: userId,
                match_count: 20,
            });

            if (error) {
                fastify.log.error(
                    { err: error, userId, queryLength: input.length, queryVectorLength: queryVector.length },
                    'search_bookmarks RPC failed',
                );
                return { results: [] };
            }

            return { results: data ?? [] };
        } catch (err) {
            fastify.log.error(
                { err, userId, queryLength: input.length, queryVectorLength: queryVector.length },
                'search_bookmarks RPC threw',
            );
            return { results: [] };
        }
    });
};
