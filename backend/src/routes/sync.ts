import { FastifyInstance } from 'fastify';
import { BookmarkService, BookmarkInput } from '../services/bookmarkService';

const bookmarkService = new BookmarkService();

export async function syncRoutes(fastify: FastifyInstance) {
    fastify.post<{ Body: { userId: string; bookmarks: BookmarkInput[] } }>(
        '/sync',
        {
            schema: {
                body: {
                    type: 'object',
                    required: ['userId', 'bookmarks'],
                    properties: {
                        userId: { type: 'string' },
                        bookmarks: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['id', 'url', 'title'],
                                properties: {
                                    id: { type: 'string' },
                                    url: { type: 'string' },
                                    title: { type: 'string' },
                                    parentId: { type: 'string' },
                                    index: { type: 'number' },
                                    dateAdded: { type: 'number' }
                                }
                            }
                        }
                    }
                }
            }
        },
        async (request, reply) => {
            const { userId, bookmarks } = request.body;

            try {
                const stats = await bookmarkService.syncBookmarks(userId, bookmarks);
                return { status: 'success', stats };
            } catch (error: any) {
                request.log.error(error);
                reply.status(500).send({ status: 'error', message: error.message || 'Failed to sync bookmarks' });
            }
        }
    );
}
