import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';

import { supabase } from '../db';
import { requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, looseObjectBodySchema } from './schemas';

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
                401: errorResponseSchema,
            },
        },
    }, async (req, reply) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        const body = req.body as SearchBody;
        const query = typeof body?.query === 'string' ? body.query : '';

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
        });
        const queryVector = response.data[0].embedding;

        const { data: results } = await supabase.rpc('search_bookmarks', {
            query_vector: queryVector,
            user_id: userId,
            match_count: 20
        });

        return { results: results ?? [] };
    });
};
