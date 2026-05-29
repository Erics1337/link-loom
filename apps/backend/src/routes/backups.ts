import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, looseObjectBodySchema, snapshotParamsSchema, userIdParamsSchema } from './schemas';

type BackupBody = {
    name?: unknown;
};

export const registerBackupRoutes = async (fastify: FastifyInstance) => {
    fastify.get('/backups/:userId', {
        schema: {
            params: userIdParamsSchema,
            response: {
                200: {
                    type: 'object',
                    required: ['backups'],
                    properties: {
                        backups: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
            const { data: snapshots, error } = await supabase
                .from('structure_snapshots')
                .select(`
                    id,
                    name,
                    created_at,
                    snapshot_clusters (
                        id,
                        snapshot_assignments (count)
                    )
                `)
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted = (snapshots || []).map((s: any) => {
                const folders = s.snapshot_clusters?.length || 0;
                const bookmarks = s.snapshot_clusters?.reduce((acc: number, cluster: any) => {
                    return acc + (cluster.snapshot_assignments?.[0]?.count || 0);
                }, 0) || 0;

                return {
                    id: s.id,
                    name: s.name,
                    createdAt: s.created_at,
                    summary: { folders, bookmarks }
                };
            });

            return { backups: formatted };
        } catch (err: any) {
            console.error('[BACKUPS] Fetch error:', err);
            return reply.code(500).send({ error: 'Failed to load backups' });
        }
    });

    fastify.post('/backups/:userId', {
        schema: {
            params: userIdParamsSchema,
            body: looseObjectBodySchema,
            response: {
                200: {
                    type: 'object',
                    required: ['status', 'snapshotId'],
                    properties: {
                        status: { type: 'string' },
                        snapshotId: { type: 'string' },
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
        const body = req.body as BackupBody;
        const name = typeof body?.name === 'string' ? body.name : '';
        try {
            const { data: snapshotId, error } = await supabase.rpc('create_structure_snapshot', {
                p_user_id: userId,
                p_snapshot_name: name || `Backup ${new Date().toLocaleDateString()}`
            });

            if (error) throw error;
            return { status: 'created', snapshotId };
        } catch (err: any) {
            console.error('[BACKUPS] Create error:', err);
            return reply.code(500).send({ error: 'Failed to create backup' });
        }
    });

    fastify.post('/backups/:userId/:snapshotId/restore', {
        schema: {
            params: snapshotParamsSchema,
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
        const { snapshotId } = req.params as { snapshotId: string };
        try {
            const { error } = await supabase.rpc('restore_structure_snapshot', {
                p_user_id: userId,
                p_snapshot_id: snapshotId
            });

            if (error) throw error;
            return { status: 'restored' };
        } catch (err: any) {
            console.error('[BACKUPS] Restore error:', err);
            return reply.code(500).send({ error: 'Failed to restore backup' });
        }
    });

    fastify.delete('/backups/:userId/:snapshotId', {
        schema: {
            params: snapshotParamsSchema,
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
        const { snapshotId } = req.params as { snapshotId: string };
        try {
            const { error } = await supabase
                .from('structure_snapshots')
                .delete()
                .eq('id', snapshotId)
                .eq('user_id', userId);

            if (error) throw error;
            return { status: 'deleted' };
        } catch (err: any) {
            console.error('[BACKUPS] Delete error:', err);
            return reply.code(500).send({ error: 'Failed to delete backup' });
        }
    });
};
