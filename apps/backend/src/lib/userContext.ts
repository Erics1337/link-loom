import type { FastifyReply, FastifyRequest } from 'fastify';

import { supabase } from '../db';

export const DEFAULT_FREE_TIER_LIMIT = 500;

const parsedFreeTierLimit = Number.parseInt(process.env.FREE_TIER_LIMIT ?? `${DEFAULT_FREE_TIER_LIMIT}`, 10);

export const FREE_TIER_LIMIT = Number.isNaN(parsedFreeTierLimit)
    ? DEFAULT_FREE_TIER_LIMIT
    : parsedFreeTierLimit;

const ALLOW_UNAUTHENTICATED_USER_ID =
    process.env.ALLOW_UNAUTHENTICATED_USER_ID === 'true' ||
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST);

const getBearerToken = (req: FastifyRequest) => {
    const header = req.headers?.authorization;
    if (typeof header !== 'string') return '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? '';
};

const getFallbackUserId = (req: FastifyRequest) => {
    const params = req.params as { userId?: unknown } | undefined;
    const body = req.body as { userId?: unknown } | undefined;
    const paramUserId = typeof params?.userId === 'string' ? params.userId : '';
    const bodyUserId = typeof body?.userId === 'string' ? body.userId : '';
    return paramUserId || bodyUserId;
};

export const requireRequestUserId = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = getBearerToken(req);
    const fallbackUserId = getFallbackUserId(req);

    if (token) {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user?.id) {
            reply.code(401).send({ error: 'Invalid or expired session.' });
            return null;
        }

        if (fallbackUserId && fallbackUserId !== data.user.id) {
            reply.code(403).send({ error: 'User id does not match authenticated session.' });
            return null;
        }

        return data.user.id;
    }

    if (ALLOW_UNAUTHENTICATED_USER_ID && fallbackUserId) {
        return fallbackUserId;
    }

    reply.code(401).send({ error: 'Authentication required.' });
    return null;
};

export const ensureUserExists = async (userId: string) => {
    const { error } = await supabase
        .from('users')
        .upsert({ id: userId }, { onConflict: 'id' });

    return error;
};

export const getUserPremiumStatus = async (userId: string) => {
    if (!userId) return false;

    const { data: user, error } = await supabase
        .from('users')
        .select('is_premium')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error(`[BILLING] Failed to load premium status for user ${userId}`, error);
    }

    return user?.is_premium ?? false;
};

export const requirePremium = async (userId: string, reply: FastifyReply) => {
    const isPremium = await getUserPremiumStatus(userId);
    if (isPremium) return true;

    reply.code(402).send({
        error: 'Premium required',
        message: 'This feature requires Link Loom Pro.',
        upgradeUrl: '/dashboard/billing'
    });
    return false;
};
