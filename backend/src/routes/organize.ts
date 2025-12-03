import { FastifyInstance } from 'fastify';
import { clusteringQueue } from '../queue/queues';

export async function organizeRoutes(fastify: FastifyInstance) {
    fastify.post<{ Body: { userId: string; settings?: any } }>(
        '/organize',
        {
            schema: {
                body: {
                    type: 'object',
                    required: ['userId'],
                    properties: {
                        userId: { type: 'string' },
                        settings: { type: 'object' }
                    }
                }
            }
        },
        async (request, reply) => {
            const { userId, settings } = request.body;

            const job = await clusteringQueue.add('cluster', {
                userId,
                settings
            }, {
                attempts: 200, // Increased from 50 to handle large bookmark sets
                backoff: {
                    type: 'exponential',
                    delay: 2000 // Start at 2s, exponentially increase
                }
            });

            // Store job ID mapping for status check
            if (job.id) {
                const { redis } = await import('../lib/redis');
                await redis.set(`job:${userId}`, job.id);
            }

            request.log.info(`Received organize request for user ${userId}, Job ID: ${job.id}`);

            return { status: 'success', message: 'Organization job queued', jobId: job.id };
        }
    );
}
