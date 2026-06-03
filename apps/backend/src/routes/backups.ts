import type { FastifyInstance, FastifyReply } from 'fastify';

import { supabase } from '../db';
import { beginUserPipelineRun } from '../lib/cancellation';
import { requireRequestUserId } from '../lib/userContext';
import {
    authenticatedStatusResponseSchema,
    errorResponseSchema,
    looseObjectBodySchema,
    objectArrayPropertySchema,
    snapshotParamsSchema,
    userIdParamsSchema
} from './schemas';

type CloudSnapshotBody = {
    name?: unknown;
};

const runSnapshotMutation = async (
    reply: FastifyReply,
    logLabel: string,
    failureMessage: string,
    status: string,
    action: () => Promise<void>
) => {
    try {
        await action();
        return { status };
    } catch (err: any) {
        console.error(`[CLOUD SNAPSHOTS] ${logLabel} error:`, err);
        return reply.code(500).send({ error: failureMessage });
    }
};

const snapshotMutationHandler =
    (
        status: string,
        logLabel: string,
        failureMessage: string,
        action: (userId: string, snapshotId: string) => Promise<void>
    ) =>
    async (req: any, reply: any) => {
        const userId = await requireRequestUserId(req, reply);
        if (!userId) return reply;
        const { snapshotId } = req.params as { snapshotId: string };
        return runSnapshotMutation(
            reply,
            logLabel,
            failureMessage,
            status,
            () => action(userId, snapshotId)
        );
    };

export const registerCloudSnapshotRoutes = async (fastify: FastifyInstance) => {
    // Keep /backups and the `backups` response key for API compatibility;
    // these records are user-facing Cloud Snapshots.
    fastify.get(
        '/backups/:userId',
        {
            schema: {
                params: userIdParamsSchema,
                response: {
                    200: {
                        type: 'object',
                        required: ['backups'],
                        properties: {
                            backups: objectArrayPropertySchema
                        }
                    },
                    401: errorResponseSchema,
                    403: errorResponseSchema,
                    500: errorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            try {
                const { data: snapshots, error } = await supabase
                    .from('structure_snapshots')
                    .select(
                        `
                    id,
                    name,
                    created_at,
                    snapshot_clusters (
                        id,
                        snapshot_assignments (count)
                    )
                `
                    )
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });

                if (error) throw error;

                const formatted = (snapshots || []).map((s: any) => {
                    const folders = s.snapshot_clusters?.length || 0;
                    const bookmarks =
                        s.snapshot_clusters?.reduce(
                            (acc: number, cluster: any) => {
                                return (
                                    acc +
                                    (cluster.snapshot_assignments?.[0]?.count ||
                                        0)
                                );
                            },
                            0
                        ) || 0;

                    return {
                        id: s.id,
                        name: s.name,
                        createdAt: s.created_at,
                        summary: { folders, bookmarks }
                    };
                });

                return { backups: formatted };
            } catch (err: any) {
                console.error('[CLOUD SNAPSHOTS] Fetch error:', err);
                return reply
                    .code(500)
                    .send({ error: 'Failed to load Cloud Snapshots' });
            }
        }
    );

    fastify.post(
        '/backups/:userId',
        {
            schema: {
                params: userIdParamsSchema,
                body: looseObjectBodySchema,
                response: {
                    200: {
                        type: 'object',
                        required: ['status', 'snapshotId'],
                        properties: {
                            status: { type: 'string' },
                            snapshotId: { type: 'string' }
                        }
                    },
                    401: errorResponseSchema,
                    403: errorResponseSchema,
                    500: errorResponseSchema
                }
            }
        },
        async (req, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const body = req.body as CloudSnapshotBody;
            const name = typeof body?.name === 'string' ? body.name : '';
            try {
                const { data: snapshotId, error } = await supabase.rpc(
                    'create_structure_snapshot',
                    {
                        p_user_id: userId,
                        p_snapshot_name:
                            name ||
                            `Cloud Snapshot ${new Date().toISOString().slice(0, 10)}`
                    }
                );

                if (error) throw error;
                return { status: 'created', snapshotId };
            } catch (err: any) {
                console.error('[CLOUD SNAPSHOTS] Create error:', err);
                return reply
                    .code(500)
                    .send({ error: 'Failed to create Cloud Snapshot' });
            }
        }
    );

    fastify.post(
        '/backups/:userId/:snapshotId/restore',
        {
            schema: {
                params: snapshotParamsSchema,
                response: authenticatedStatusResponseSchema
            }
        },
        snapshotMutationHandler(
            'restored',
            'Restore',
            'Failed to restore Cloud Snapshot',
            async (userId, snapshotId) => {
                await beginUserPipelineRun(userId);
                const { error } = await supabase.rpc(
                    'restore_structure_snapshot',
                    {
                        p_user_id: userId,
                        p_snapshot_id: snapshotId
                    }
                );

                if (error) throw error;
            }
        )
    );

    fastify.delete(
        '/backups/:userId/:snapshotId',
        {
            schema: {
                params: snapshotParamsSchema,
                response: authenticatedStatusResponseSchema
            }
        },
        snapshotMutationHandler(
            'deleted',
            'Delete',
            'Failed to delete Cloud Snapshot',
            async (userId, snapshotId) => {
                const { error } = await supabase
                    .from('structure_snapshots')
                    .delete()
                    .eq('id', snapshotId)
                    .eq('user_id', userId);

                if (error) throw error;
            }
        )
    );
};
