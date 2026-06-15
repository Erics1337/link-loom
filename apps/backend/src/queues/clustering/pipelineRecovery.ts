import { supabase } from '../../db';
import { queues } from '../../lib/queue';
import { parseBookmarkVector } from './vectorParsing';

export const recoverStalePipelineState = async (
    userId: string,
    pipelineRunId: string | undefined,
    jobGeneration: number | undefined,
    log: (msg: string) => void
) => {
    const { data: inflightBookmarks, error: inflightError } = await supabase
        .from('bookmarks')
        .select(
            `
            id,
            status,
            title,
            description,
            url,
            shared_links!content_hash (vector)
        `
        )
        .eq('user_id', userId)
        .in('status', ['pending', 'enriched']);

    if (inflightError) {
        log(
            `[CLUSTERING] Recovery query failed for user ${userId}: ${JSON.stringify(inflightError)}`
        );
        return;
    }

    if (!inflightBookmarks || inflightBookmarks.length === 0) return;

    const toMarkEmbedded: string[] = [];
    const toQueueEnrichment: Array<{ bookmarkId: string; url: string }> = [];
    const toQueueEmbedding: Array<{
        bookmarkId: string;
        url: string;
    }> = [];

    for (const bookmark of inflightBookmarks as Array<{
        id: string;
        status: string;
        title?: string | null;
        description?: string | null;
        url?: string | null;
        shared_links?: unknown;
    }>) {
        const parsedVector = parseBookmarkVector(bookmark.shared_links, (e) =>
            log(`Failed to parse vector JSON: ${e}`)
        );

        if (parsedVector) {
            toMarkEmbedded.push(bookmark.id);
            continue;
        }

        if (!bookmark.url) continue;

        if (bookmark.status === 'enriched') {
            toQueueEmbedding.push({
                bookmarkId: bookmark.id,
                url: bookmark.url
            });
            continue;
        }

        if (bookmark.status === 'pending') {
            toQueueEnrichment.push({
                bookmarkId: bookmark.id,
                url: bookmark.url
            });
        }
    }

    if (toMarkEmbedded.length > 0) {
        const { error: markEmbeddedError } = await supabase
            .from('bookmarks')
            .update({ status: 'embedded' })
            .in('id', toMarkEmbedded);

        if (markEmbeddedError) {
            log(
                `[CLUSTERING] Recovery failed to mark embedded for user ${userId}: ${JSON.stringify(markEmbeddedError)}`
            );
        } else {
            log(
                `[CLUSTERING] Recovery marked ${toMarkEmbedded.length} stale bookmarks as embedded for user ${userId}`
            );
        }
    }

    let enrichmentQueued = 0;
    let enrichmentFailed = 0;
    for (const enrichmentJob of toQueueEnrichment) {
        try {
            await queues.enrichment.add('enrich', {
                userId,
                pipelineRunId,
                jobGeneration,
                bookmarkId: enrichmentJob.bookmarkId,
                url: enrichmentJob.url
            });
            enrichmentQueued++;
        } catch (error) {
            enrichmentFailed++;
            log(
                `[CLUSTERING] Recovery failed to queue enrichment for user ${userId}: ${JSON.stringify({
                    pipelineRunId,
                    jobGeneration,
                    bookmarkId: enrichmentJob.bookmarkId,
                    url: enrichmentJob.url,
                    error: error instanceof Error ? error.message : error,
                })}`
            );
        }
    }

    let embeddingQueued = 0;
    let embeddingFailed = 0;
    for (const embeddingJob of toQueueEmbedding) {
        try {
            await queues.embedding.add('embed', {
                userId,
                pipelineRunId,
                jobGeneration,
                bookmarkId: embeddingJob.bookmarkId,
                url: embeddingJob.url
            });
            embeddingQueued++;
        } catch (error) {
            embeddingFailed++;
            log(
                `[CLUSTERING] Recovery failed to queue embedding for user ${userId}: ${JSON.stringify({
                    pipelineRunId,
                    jobGeneration,
                    bookmarkId: embeddingJob.bookmarkId,
                    url: embeddingJob.url,
                    error: error instanceof Error ? error.message : error,
                })}`
            );
        }
    }

    if (toQueueEnrichment.length > 0 || toQueueEmbedding.length > 0) {
        log(
            `[CLUSTERING] Recovery queued enrichment=${enrichmentQueued}/${toQueueEnrichment.length}, embedding=${embeddingQueued}/${toQueueEmbedding.length} for user ${userId}` +
            (enrichmentFailed > 0 || embeddingFailed > 0
                ? ` (failures: enrichment=${enrichmentFailed}, embedding=${embeddingFailed})`
                : '')
        );
    }
};
