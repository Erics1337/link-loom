import { supabase } from '../db';

const cancelledUsers = new Set<string>();

const persistCancellation = async (userId: string, isCancelled: boolean) => {
    const { error } = await supabase
        .from('user_pipeline_controls')
        .upsert(
            {
                user_id: userId,
                is_cancelled: isCancelled,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        );

    if (error) {
        console.error(`[CANCEL] Failed to persist cancellation=${isCancelled} for user ${userId}`, error);
    }
};

export const markUserCancelled = async (userId: string) => {
    cancelledUsers.add(userId);
    await persistCancellation(userId, true);
};

export const clearUserCancelled = async (userId: string) => {
    cancelledUsers.delete(userId);
    await persistCancellation(userId, false);
};

export const isUserCancelled = async (userId: string) => {
    if (cancelledUsers.has(userId)) return true;

    const { data, error } = await supabase
        .from('user_pipeline_controls')
        .select('is_cancelled')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error(`[CANCEL] Failed to load cancellation state for user ${userId}`, error);
        return false;
    }

    if (data?.is_cancelled) {
        cancelledUsers.add(userId);
        return true;
    }

    return false;
};
