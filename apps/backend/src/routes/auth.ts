import type { FastifyInstance } from 'fastify';

import { supabase } from '../db';
import { ensureUserExists, requireRequestUserId } from '../lib/userContext';
import {
    authenticatedStatusResponseSchema,
    looseObjectBodySchema
} from './schemas';

type RegisterDeviceBody = {
    deviceId?: unknown;
    name?: unknown;
};

export const registerAuthRoutes = async (fastify: FastifyInstance) => {
    fastify.post(
        '/register-device',
        {
            schema: {
                body: looseObjectBodySchema,
                response: authenticatedStatusResponseSchema
            }
        },
        async (req, reply) => {
            const userId = await requireRequestUserId(req, reply);
            if (!userId) return reply;
            const body = req.body as RegisterDeviceBody;
            const deviceId =
                typeof body?.deviceId === 'string' ? body.deviceId : '';
            const name = typeof body?.name === 'string' ? body.name : '';

            if (deviceId.trim().length === 0) {
                return reply.code(400).send({ error: 'deviceId is required' });
            }

            const userError = await ensureUserExists(userId);
            if (userError) {
                console.error(
                    '[Device] Failed to ensure user exists:',
                    userError
                );
                return reply
                    .code(500)
                    .send({ error: 'Failed to initialize user' });
            }

            const { data, error } = await supabase.rpc('register_user_device', {
                p_user_id: userId,
                p_device_id: deviceId,
                p_device_name: name || 'Unknown Device'
            });

            if (error) {
                if (error.message?.includes('Device limit reached')) {
                    return reply
                        .code(403)
                        .send({
                            error: 'Device limit reached. Please manage devices in dashboard.'
                        });
                }
                console.error('[Device] Registration error:', error);
                return reply
                    .code(500)
                    .send({ error: 'Failed to register device' });
            }

            return { status: 'registered' };
        }
    );
};
