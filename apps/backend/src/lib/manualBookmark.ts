import { randomUUID } from 'crypto';
import { supabase } from '../db';
import { queues } from './queue';
import { beginUserPipelineRun } from './cancellation';
import { ClusteringSettings, normalizeClusteringSettings } from './clusteringSettings';

type QueueManualBookmarkInput = {
    userId: string;
    rawUrl: string;
    title?: string;
    freeTierLimit: number;
    isPremium: boolean;
    clusteringSettings?: ClusteringSettings;
};

export type QueueManualBookmarkResult =
    | { ok: true; chromeId: string }
    | { ok: false; statusCode: number; payload: Record<string, unknown> };

export const queueManualBookmark = async ({
    userId,
    rawUrl,
    title,
    freeTierLimit,
    isPremium,
    clusteringSettings,
}: QueueManualBookmarkInput): Promise<QueueManualBookmarkResult> => {
    const trimmedUrl = rawUrl.trim();
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(trimmedUrl);
    } catch {
        return { ok: false, statusCode: 400, payload: { error: 'A valid URL is required.' } };
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { ok: false, statusCode: 400, payload: { error: 'Only http and https URLs can be saved.' } };
    }

    if (!isPremium) {
        const { count: existingCount, error: countError } = await supabase
            .from('bookmarks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (countError) {
            console.error('[BOOKMARKS] Failed to count bookmarks:', countError);
            return { ok: false, statusCode: 500, payload: { error: 'Failed to check bookmark limit' } };
        }

        if ((existingCount ?? 0) >= freeTierLimit) {
            return {
                ok: false,
                statusCode: 402,
                payload: {
                    error: 'Bookmark limit exceeded',
                    message: `Free tier allows up to ${freeTierLimit} bookmarks stored in Link Loom.`,
                    limit: freeTierLimit,
                    current: existingCount ?? 0,
                    attempted: 1,
                    upgradeUrl: '/dashboard/billing',
                },
            };
        }
    }

    const jobGeneration = await beginUserPipelineRun(userId);

    const { error: deleteClustersError } = await supabase
        .from('clusters')
        .delete()
        .eq('user_id', userId);

    if (deleteClustersError) {
        console.warn(`[BOOKMARKS] Warning: Failed to clear old clusters for user ${userId}`, deleteClustersError);
    }

    const chromeId = `manual-${randomUUID()}`;
    await queues.ingest.add('ingest', {
        userId,
        jobGeneration,
        bookmarks: [{
            id: chromeId,
            url: parsedUrl.toString(),
            title: title?.trim() || parsedUrl.toString(),
        }],
        clusteringSettings: normalizeClusteringSettings(clusteringSettings),
    }, {
        jobId: `ingest-${userId}-manual-generation-${jobGeneration}`,
    });

    return { ok: true, chromeId };
};
