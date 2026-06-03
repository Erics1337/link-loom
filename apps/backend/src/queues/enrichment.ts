import { QueueJob, queues } from '../lib/queue';
import { supabase } from '../db';
import { isUserCancelled } from '../lib/cancellation';
import { ClusteringSettings, normalizeClusteringSettings } from '../lib/clusteringSettings';
import { notifyPipelineBookmarkTerminal } from '../lib/pipelineCoordinator';
import { safeFetch } from '../lib/safeFetch';

import * as cheerio from 'cheerio';

export interface EnrichmentJobData {
    userId: string;
    pipelineRunId?: string;
    jobGeneration?: number;
    clusteringSettings?: ClusteringSettings;
    bookmarkId: string;
    url: string;
}

const exitIfCancelled = async (
    userId: string,
    jobGeneration: number | undefined,
    pipelineRunId: string | undefined,
    bookmarkId: string,
    clusteringSettings: ClusteringSettings,
    checkpoint: string
) => {
    if (!(await isUserCancelled(userId, jobGeneration, pipelineRunId))) {
        return false;
    }

    console.log(`[ENRICHMENT] Cancelled ${checkpoint} for user ${userId}`);
    await notifyPipelineBookmarkTerminal(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings);
    return true;
};

export const enrichmentProcessor = async (job: QueueJob<EnrichmentJobData>) => {
    const { userId, pipelineRunId, jobGeneration, bookmarkId, url } = job.data;
    const clusteringSettings = normalizeClusteringSettings(job.data.clusteringSettings);
    console.log(`Enriching bookmark ${bookmarkId}: ${url}`);

    if (await exitIfCancelled(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings, 'before start')) {
        return;
    }

    let description = '';
    let title = '';

    try {
        const response = await safeFetch(url, { timeoutMs: 5000 });
        const html = await response.text();
        const $ = cheerio.load(html);
        title = $('title').text().trim() || '';
        description = $('meta[name="description"]').attr('content') || '';
    } catch (err: any) {
        if (err.name === 'AbortError') {
             console.warn(`[SCRAPE TIMEOUT] ${url}`);
        } else {
             console.warn(`[SCRAPE FAILED] ${url}: ${err.message}`);
        }
    }

    if (await exitIfCancelled(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings, 'after fetch')) {
        return;
    }

    // Update DB
    const { error: enrichmentUpdateError } = await supabase
        .from('bookmarks')
        .update({ description, status: 'enriched' })
        .eq('id', bookmarkId);
    if (enrichmentUpdateError) {
        console.error(`[ENRICHMENT] Failed to update bookmark ${bookmarkId}:`, enrichmentUpdateError);
        await supabase
            .from('bookmarks')
            .update({ status: 'error' })
            .eq('id', bookmarkId);
        await notifyPipelineBookmarkTerminal(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings);
        return;
    }

    if (await exitIfCancelled(userId, jobGeneration, pipelineRunId, bookmarkId, clusteringSettings, 'before embedding enqueue')) {
        return;
    }

    // Add to Embedding Queue
    await queues.embedding.add(
        'embed',
        {
            userId,
            pipelineRunId,
            clusteringSettings,
            bookmarkId,
            text: `${title} ${description} ${url}`,
            url,
        },
        {
            jobId: `embed-${userId}-run-${pipelineRunId || jobGeneration || 'legacy'}-${bookmarkId}`,
        }
    );
};
