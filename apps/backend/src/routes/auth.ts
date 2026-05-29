import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { ensureUserExists, requireRequestUserId } from '../lib/userContext';
import { errorResponseSchema, looseObjectBodySchema } from './schemas';

type RegisterDeviceBody = {
    deviceId?: unknown;
    name?: unknown;
};

export const registerAuthRoutes = async (fastify: FastifyInstance) => {
    fastify.post('/register-device', {
        schema: {
            body: looseObjectBodySchema,
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
        const body = req.body as RegisterDeviceBody;
        const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
        const name = typeof body?.name === 'string' ? body.name : '';

        const userError = await ensureUserExists(userId);
        if (userError) {
            console.error('[Device] Failed to ensure user exists:', userError);
            return reply.code(500).send({ error: 'Failed to initialize user' });
        }

        const { count, error: countError } = await supabase
            .from('user_devices')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (countError) {
            console.error('[Device] Count error:', countError);
            return reply.code(500).send({ error: 'Database error' });
        }

        const { data: existing } = await supabase
            .from('user_devices')
            .select('id')
            .eq('user_id', userId)
            .eq('device_id', deviceId)
            .maybeSingle();

        if (existing) {
            const { error: updateError } = await supabase
                .from('user_devices')
                .update({ last_seen_at: new Date() })
                .eq('id', existing.id);

            if (updateError) {
                console.error('[Device] Update error:', updateError);
                return reply.code(500).send({ error: 'Failed to update device' });
            }

            return { status: 'registered' };
        }

        if ((count ?? 0) >= 3) {
            return reply.code(403).send({ error: 'Device limit reached. Please manage devices in dashboard.' });
        }

        const { error: insertError } = await supabase.from('user_devices').insert({
            user_id: userId,
            device_id: deviceId,
            name: name || 'Unknown Device'
        });

        if (insertError) {
            console.error('[Device] Insert error:', insertError);
            return reply.code(500).send({ error: 'Failed to register device' });
        }

        return { status: 'registered' };
    });
};
