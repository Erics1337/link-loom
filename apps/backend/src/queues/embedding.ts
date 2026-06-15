import { QueueJob } from '../lib/queue';
import { supabase } from '../db';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import {
    createPipelineCancellationLookupCache,
    isUserCancelled,
    type PipelineCancellationLookupCache,
} from '../lib/cancellation';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';
import { notifyPipelineBookmarkTerminal } from '../lib/pipelineCoordinator';
import { safeFetch } from '../lib/safeFetch';

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
    text?: string;
    url: string;
}

const extractPageText = ($: cheerio.CheerioAPI) => {
    $('script, style, noscript, svg, nav, footer, header, form').remove();
    const parts = [
        $('main').text(),
        $('article').text(),
        $('[role="main"]').text(),
        $('body').text()
    ];

    const text = parts
        .find((part) => part && part.trim().length >= 200)
        ?? parts.find((part) => part && part.trim().length > 0)
        ?? '';

    return text.replace(/\s+/g, ' ').trim().slice(0, 4000);
};

const buildEmbeddingText = (parts: Array<string | null | undefined>) =>
    parts.map((part) => part?.trim()).filter(Boolean).join(' ');

const getUrlLogId = (url: string) =>
    createHash('sha256').update(url).digest('hex').slice(0, 12);

const loadBookmarkMetadataText = async (bookmarkId: string) => {
    const { data, error } = await supabase
        .from('bookmarks')
        .select('title, ai_title, description')
        .eq('id', bookmarkId)
        .single();

    if (error) {
        throw new Error(`Failed to load bookmark ${bookmarkId} for embedding: ${error.message}`);
    }

    const bookmark = data as {
        title?: string | null;
        ai_title?: string | null;
        description?: string | null;
    } | null;

    return buildEmbeddingText([
        bookmark?.ai_title,
        bookmark?.title,
        bookmark?.description
    ]);
};

const loadPageText = async (url: string) => {
    const urlLogId = getUrlLogId(url);
    try {
        const response = await safeFetch(url, { timeoutMs: 5000 });
        const html = await response.text();
        return extractPageText(cheerio.load(html));
    } catch (err: any) {
        if (err.name === 'AbortError') {
            console.warn(`[EMBEDDING SCRAPE TIMEOUT] urlHash=${urlLogId}`);
        } else {
            console.warn(`[EMBEDDING SCRAPE FAILED] urlHash=${urlLogId}: ${err.name || 'Error'}`);
        }
        return '';
    }
};

const buildBookmarkEmbeddingInput = async (
    bookmarkId: string,
    url: string,
    legacyQueuedText?: string
) => {
    if (legacyQueuedText?.trim()) {
        return legacyQueuedText;
    }

    const [metadataText, pageText] = await Promise.all([
        loadBookmarkMetadataText(bookmarkId),
        loadPageText(url)
    ]);

    return buildEmbeddingText([metadataText, pageText, url]);
};

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
            throw new Error(`Shared link lookup failed for urlHash=${urlHash}: ${cacheLookupError.message}`);
        }

        let vector: number[];

        if (cached?.vector) {
            console.log(`Cache HIT for urlHash=${urlHash}`);
            vector = cached.vector;
        } else {
            console.log(`Cache MISS for urlHash=${urlHash} - Calling OpenAI`);
            const embeddingInput = await buildBookmarkEmbeddingInput(bookmarkId, url, text);
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: embeddingInput.substring(0, 8000),
            });
            vector = response.data[0].embedding;

            // Save to Shared Cache
            const { error: sharedUpdateError } = await supabase
                .from('shared_links')
                .update({ vector })
                .eq('id', urlHash);
            if (sharedUpdateError) {
                throw new Error(`Failed to persist shared vector for urlHash=${urlHash}: ${sharedUpdateError.message}`);
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
