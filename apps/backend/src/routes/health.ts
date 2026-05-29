import type { FastifyInstance } from 'fastify';

export const registerHealthRoutes = async (fastify: FastifyInstance) => {
    fastify.get('/health', {
        schema: {
            response: {
                200: {
                    type: 'object',
                    required: ['status'],
                    properties: {
                        status: { type: 'string' },
                    },
                },
            },
        },
    }, async () => {
        return { status: 'ok' };
    });
};
