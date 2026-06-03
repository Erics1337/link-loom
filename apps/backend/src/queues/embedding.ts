import { QueueJob } from '../lib/queue';
import { supabase } from '../db';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import {
    createPipelineCancellationLookupCache,
    isUserCancelled,
    type PipelineCancellationLookupCache,
} from '../lib/cancellation';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';
import { notifyPipelineBookmarkTerminal } from '../lib/pipelineCoordinator';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class EmbeddingCancellationExitError extends Error {
    readonly originalError: unknown;

    constructor(cause: unknown) {
        super('Failed to evaluate or record embedding cancellation');
        this.name = 'EmbeddingCancellationExitError';
        this.originalError = cause;
    }
}

export interface EmbeddingJobData {
    userId: string;
    pipelineRunId?: string;
    jobGeneration?: number;
    clusteringSettings?: ClusteringSettings;
    bookmarkId: string;
    text: string;
    url: string;
}

const exitIfCancelled = async (
    userId: string,
    jobGeneration: number | undefined,
    pipelineRunId: string | undefined,
    bookmarkId: string,
    clusteringSettings: ClusteringSettings,
    checkpoint: string,
    cancellationCache: PipelineCancellationLookupCache
) => {
    try {
        if (!(await isUserCancelled(userId, jobGeneration, pipelineRunId, cancellationCache))) {
            return false;
        }

        console.log(`[EMBEDDING] Cancelled ${checkpoint} for user ${userId}`);
        await notifyPipelineBookmarkTerminal(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings);
        return true;
    } catch (error) {
        throw new EmbeddingCancellationExitError(error);
    }
};

export const embeddingProcessor = async (job: QueueJob<EmbeddingJobData>) => {
    const { userId, pipelineRunId, jobGeneration, bookmarkId, text, url } = job.data;
    const clusteringSettings = normalizeClusteringSettings(job.data.clusteringSettings);
    const cancellationCache = createPipelineCancellationLookupCache();
    console.log(`Processing bookmark ${bookmarkId}`);

    try {
        if (await exitIfCancelled(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings, 'before start', cancellationCache)) {
            return;
        }

        // 1. Calculate Hash
        const urlHash = createHash('sha256').update(url).digest('hex');

        // 2. Check Shared Cache
        const { data: cached, error: cacheLookupError } = await supabase
            .from('shared_links')
            .select('vector')
            .eq('id', urlHash)
            .single();
        if (cacheLookupError) {
            throw new Error(`Shared link lookup failed for ${url}: ${cacheLookupError.message}`);
        }

        let vector: number[];

        if (cached?.vector) {
            console.log(`Cache HIT for ${url}`);
            vector = cached.vector;
        } else {
            console.log(`Cache MISS for ${url} - Calling OpenAI`);
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: text.substring(0, 8000),
            });
            vector = response.data[0].embedding;

            // Save to Shared Cache
            const { error: sharedUpdateError } = await supabase
                .from('shared_links')
                .update({ vector })
                .eq('id', urlHash);
            if (sharedUpdateError) {
                throw new Error(`Failed to persist shared vector for ${url}: ${sharedUpdateError.message}`);
            }
        }

        // 3. Update Status
        if (await exitIfCancelled(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings, 'before status update', cancellationCache)) {
            return;
        }

        const { error: bookmarkStatusError } = await supabase
            .from('bookmarks')
            .update({ status: 'embedded' })
            .eq('id', bookmarkId);
        if (bookmarkStatusError) {
            throw new Error(`Failed to mark bookmark ${bookmarkId} as embedded: ${bookmarkStatusError.message}`);
        }
        await notifyPipelineBookmarkTerminal(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings);

    } catch (err) {
        if (err instanceof EmbeddingCancellationExitError) {
            throw err.originalError ?? err;
        }

        console.error(`Failed to embed ${bookmarkId}`, err);
        await supabase
            .from('bookmarks')
            .update({ status: 'error' })
            .eq('id', bookmarkId);
        await notifyPipelineBookmarkTerminal(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings);
    }
};
