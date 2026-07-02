import { QueueJob, queues } from '../lib/queue';
import { supabase } from '../db';
import { createHash } from 'crypto';
import { isUserCancelled } from '../lib/cancellation';
import {
    ClusteringSettings,
    normalizeClusteringSettings
} from '../lib/clusteringSettings';
import { createLimit } from '../lib/limit';
import { normalizeBookmarkUrl } from '../lib/normalizeUrl';
import {
    notifyPipelineBookmarkTerminal,
    recordPipelineIngestCompleted,
    recordPipelineIngestTotal,
    recordPipelineUntrackedError
} from '../lib/pipelineCoordinator';

export interface IngestJobData {
    userId: string;
    bookmarks: {
        id: string; // Chrome ID
        url: string;
        title: string;
        parentId?: string;
        parentTitle?: string;
    }[];
    clusteringSettings?: ClusteringSettings;
    pipelineRunId?: string;
    jobGeneration?: number;
}

const INGEST_CHUNK_SIZE = 100;
const INGEST_NOTIFY_CONCURRENCY = 10;
const EXISTING_FETCH_PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 200;

type ScannedBookmark = IngestJobData['bookmarks'][number];

type HashedBookmark = ScannedBookmark & { urlHash: string };

type InsertedBookmarkRow = {
    id: string;
    chrome_id: string;
    url: string;
};

type ExistingBookmarkRow = {
    id: string;
    chrome_id: string;
    url: string;
    title: string | null;
    chrome_parent_id: string | null;
};

type NewOrUrlChanged =
    | { kind: 'new'; item: ScannedBookmark }
    | { kind: 'urlChanged'; item: ScannedBookmark; existing: ExistingBookmarkRow };

type MetadataChanged = {
    kind: 'metadata';
    item: ScannedBookmark;
    existing: ExistingBookmarkRow;
    titleChanged: boolean;
    parentChanged: boolean;
};

type Classified = NewOrUrlChanged | MetadataChanged | { kind: 'unchanged' };

const fetchExistingBookmarksByChromeId = async (userId: string) => {
    const byChromeId = new Map<string, ExistingBookmarkRow>();
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from('bookmarks')
            .select('id, chrome_id, url, title, chrome_parent_id')
            .eq('user_id', userId)
            .order('id', { ascending: true })
            .range(from, from + EXISTING_FETCH_PAGE_SIZE - 1);

        if (error) {
            console.error(
                `[INGEST WORKER] Failed to fetch existing bookmarks for user ${userId}:`,
                error
            );
            throw error;
        }

        if (!data || data.length === 0) break;

        for (const row of data as ExistingBookmarkRow[]) {
            byChromeId.set(row.chrome_id, row);
        }

        if (data.length < EXISTING_FETCH_PAGE_SIZE) break;
        from += EXISTING_FETCH_PAGE_SIZE;
    }

    return byChromeId;
};

const fetchClusterIdsByChromeFolderId = async (userId: string) => {
    const byFolderId = new Map<string, string>();
    const { data, error } = await supabase
        .from('clusters')
        .select('id, chrome_folder_id')
        .eq('user_id', userId)
        .not('chrome_folder_id', 'is', null);

    if (error) {
        console.error(
            `[INGEST WORKER] Failed to fetch cluster folder map for user ${userId}:`,
            error
        );
        return byFolderId;
    }

    for (const row of data ?? []) {
        if (row.chrome_folder_id) byFolderId.set(row.chrome_folder_id, row.id);
    }

    return byFolderId;
};

// Re-points a bookmark at a new (already-known) cluster, replacing whatever
// assignment it had before — used both for pin detection (folder moved) and
// for brand-new bookmarks that already sit in a recognized folder.
const pinBookmarkToCluster = async (bookmarkId: string, clusterId: string) => {
    await supabase.from('cluster_assignments').delete().eq('bookmark_id', bookmarkId);
    const { error } = await supabase.from('cluster_assignments').insert({
        cluster_id: clusterId,
        bookmark_id: bookmarkId,
        is_pinned: true,
        pinned_at: new Date().toISOString()
    });
    if (error) {
        console.error(
            `[INGEST WORKER] Failed to pin bookmark ${bookmarkId} to cluster ${clusterId}:`,
            error
        );
    }
};

// A bookmark moved into a Chrome folder Link Loom doesn't recognize as an
// existing cluster (e.g. a folder the user made by hand). Mint a cluster to
// represent it so the structure preview reflects where the user put it.
const ensureClusterForChromeFolder = async (
    userId: string,
    chromeFolderId: string,
    parentTitle: string | undefined,
    clusterIdByChromeFolderId: Map<string, string>
): Promise<string | null> => {
    const existing = clusterIdByChromeFolderId.get(chromeFolderId);
    if (existing) return existing;

    const { data, error } = await supabase
        .from('clusters')
        .insert({
            user_id: userId,
            name: parentTitle?.trim() || 'Manually organized',
            parent_id: null,
            chrome_folder_id: chromeFolderId
        })
        .select('id')
        .single();

    if (error || !data?.id) {
        console.error(
            `[INGEST WORKER] Failed to create cluster for manual folder ${chromeFolderId}:`,
            error
        );
        return null;
    }

    clusterIdByChromeFolderId.set(chromeFolderId, data.id);
    return data.id;
};

export const ingestProcessor = async (job: QueueJob<IngestJobData>) => {
    const { userId, bookmarks: rawBookmarks } = job.data;
    const { jobGeneration, pipelineRunId } = job.data;
    const clusteringSettings = normalizeClusteringSettings(
        job.data.clusteringSettings
    );
    console.log(
        `[INGEST WORKER] Starting: ${rawBookmarks.length} bookmarks for user ${userId}`
    );

    try {
        if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
            console.log(
                `[INGEST WORKER] Cancelled before start for user ${userId}`
            );
            return;
        }

        await job.updateProgress({ processed: 0, total: rawBookmarks.length });

        // Ensure user exists (create if missing)
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('id', userId)
            .single();

        if (!existingUser) {
            console.log(`[INGEST WORKER] Creating user ${userId}`);
            await supabase
                .from('users')
                .upsert({ id: userId }, { onConflict: 'id' });
        }

        // Global de-dupe by chrome id (last occurrence wins, matching upsert
        // overwrite semantics — a chrome id should never repeat in a real scan).
        const dedupedByChromeId = new Map<string, ScannedBookmark>();
        for (const b of rawBookmarks) dedupedByChromeId.set(b.id, b);
        const dedupedBookmarks = Array.from(dedupedByChromeId.values());
        const incomingChromeIds = new Set(dedupedBookmarks.map((b) => b.id));

        const existingByChromeId = await fetchExistingBookmarksByChromeId(userId);
        const clusterIdByChromeFolderId = await fetchClusterIdsByChromeFolderId(userId);

        const classifications: Classified[] = dedupedBookmarks.map((item) => {
            const existing = existingByChromeId.get(item.id);
            if (!existing) return { kind: 'new', item };
            if (existing.url !== item.url) return { kind: 'urlChanged', item, existing };

            const titleChanged = (existing.title ?? '') !== item.title;
            const parentChanged =
                (existing.chrome_parent_id ?? null) !== (item.parentId ?? null);
            if (!titleChanged && !parentChanged) return { kind: 'unchanged' };
            return { kind: 'metadata', item, existing, titleChanged, parentChanged };
        });

        const newOrUrlChanged = classifications.filter(
            (c): c is NewOrUrlChanged => c.kind === 'new' || c.kind === 'urlChanged'
        );
        const metadataChanged = classifications.filter(
            (c): c is MetadataChanged => c.kind === 'metadata'
        );
        const unchangedCount =
            classifications.length - newOrUrlChanged.length - metadataChanged.length;
        const removedChromeIds = Array.from(existingByChromeId.keys()).filter(
            (id) => !incomingChromeIds.has(id)
        );

        console.log(
            `[INGEST WORKER] Diff for user ${userId}: ${
                newOrUrlChanged.filter((c) => c.kind === 'new').length
            } new, ${
                newOrUrlChanged.filter((c) => c.kind === 'urlChanged').length
            } url-changed, ${metadataChanged.length} metadata-changed, ${unchangedCount} unchanged, ${removedChromeIds.length} removed`
        );

        // The route recorded totals.total as the full scan size before the diff
        // was known; correct it down to what will actually be (re-)embedded so
        // the clustering-readiness gate (terminal_count >= total) still closes.
        await recordPipelineIngestTotal(
            userId,
            jobGeneration,
            pipelineRunId,
            newOrUrlChanged.length
        );

        if (removedChromeIds.length > 0) {
            for (let i = 0; i < removedChromeIds.length; i += DELETE_BATCH_SIZE) {
                const batch = removedChromeIds.slice(i, i + DELETE_BATCH_SIZE);
                const { error } = await supabase
                    .from('bookmarks')
                    .delete()
                    .eq('user_id', userId)
                    .in('chrome_id', batch);
                if (error) {
                    console.error(
                        `[INGEST WORKER] Failed to delete ${batch.length} removed bookmarks:`,
                        error
                    );
                }
            }
        }

        // A changed URL means the bookmark's content is effectively different —
        // its old placement no longer means anything, pinned or not.
        const urlChangedExistingIds = newOrUrlChanged
            .filter((c): c is Extract<NewOrUrlChanged, { kind: 'urlChanged' }> =>
                c.kind === 'urlChanged'
            )
            .map((c) => c.existing.id);
        if (urlChangedExistingIds.length > 0) {
            await supabase
                .from('cluster_assignments')
                .delete()
                .in('bookmark_id', urlChangedExistingIds);
        }

        // --- Metadata-only changes (title and/or folder move; no re-embedding) ---
        const limitMetadata = createLimit(INGEST_NOTIFY_CONCURRENCY);
        await Promise.all(
            metadataChanged.map(({ item, existing, titleChanged, parentChanged }) =>
                limitMetadata(async () => {
                    const updates: Record<string, unknown> = {};
                    if (titleChanged) updates.title = item.title;
                    if (parentChanged) updates.chrome_parent_id = item.parentId ?? null;

                    const { error } = await supabase
                        .from('bookmarks')
                        .update(updates)
                        .eq('id', existing.id);
                    if (error) {
                        console.error(
                            `[INGEST WORKER] Failed to update metadata for bookmark ${existing.id}:`,
                            error
                        );
                        return;
                    }

                    if (!parentChanged || !item.parentId) return;

                    const parentId = item.parentId;
                    const matchedClusterId = clusterIdByChromeFolderId.get(parentId);
                    const clusterId =
                        matchedClusterId ??
                        (await ensureClusterForChromeFolder(
                            userId,
                            parentId,
                            item.parentTitle,
                            clusterIdByChromeFolderId
                        ));

                    if (clusterId) {
                        await pinBookmarkToCluster(existing.id, clusterId);
                    }
                })
            )
        );

        // --- New / URL-changed bookmarks: existing embedding-cache pipeline ---
        const recordChunkUntracked = async (
            items: HashedBookmark[],
            stage: string
        ) => {
            for (const item of items) {
                await recordPipelineUntrackedError(
                    userId,
                    jobGeneration,
                    pipelineRunId,
                    clusteringSettings,
                    `${stage}:${item.id}:${item.urlHash}`
                );
            }
        };

        const limitNotify = createLimit(INGEST_NOTIFY_CONCURRENCY);
        let saved = 0;
        let handled = metadataChanged.length + unchangedCount;

        const embedItems = newOrUrlChanged.map((c) => c.item);

        for (
            let chunkStart = 0;
            chunkStart < embedItems.length;
            chunkStart += INGEST_CHUNK_SIZE
        ) {
            if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
                console.log(
                    `[INGEST WORKER] Cancelled during ingest for user ${userId}`
                );
                return;
            }

            const chunk = embedItems.slice(chunkStart, chunkStart + INGEST_CHUNK_SIZE);
            handled += chunk.length;

            const items: HashedBookmark[] = chunk.map((b) => ({
                ...b,
                urlHash: createHash('sha256')
                    .update(normalizeBookmarkUrl(b.url))
                    .digest('hex')
            }));

            // 1. Ensure shared links exist (idempotent, one round trip)
            const sharedRowsById = new Map<string, { id: string; url: string }>();
            for (const item of items) {
                if (!sharedRowsById.has(item.urlHash)) {
                    sharedRowsById.set(item.urlHash, {
                        id: item.urlHash,
                        url: item.url
                    });
                }
            }
            const { error: sharedUpsertError } = await supabase
                .from('shared_links')
                .upsert(Array.from(sharedRowsById.values()), {
                    onConflict: 'id'
                });
            if (sharedUpsertError) {
                console.error(
                    `[INGEST WORKER] Failed to upsert ${sharedRowsById.size} shared links:`,
                    sharedUpsertError
                );
                await recordChunkUntracked(items, 'shared-link');
                await job.updateProgress({
                    processed: handled,
                    total: rawBookmarks.length
                });
                continue;
            }

            // 2. Insert bookmarks linked to shared links (one round trip)
            const { data: insertedRows, error: bookmarkUpsertError } =
                await supabase
                    .from('bookmarks')
                    .upsert(
                        items.map((item) => ({
                            user_id: userId,
                            chrome_id: item.id,
                            url: item.url,
                            title: item.title,
                            content_hash: item.urlHash,
                            chrome_parent_id: item.parentId ?? null,
                            pipeline_run_id: pipelineRunId ?? null,
                            status: 'pending'
                        })),
                        { onConflict: 'chrome_id,user_id' }
                    )
                    .select('id, chrome_id, url');
            if (bookmarkUpsertError || !insertedRows) {
                if (bookmarkUpsertError) {
                    console.error(
                        `[INGEST WORKER] Failed to upsert ${items.length} bookmarks:`,
                        bookmarkUpsertError
                    );
                }
                await recordChunkUntracked(items, 'bookmark-upsert');
                await job.updateProgress({
                    processed: handled,
                    total: rawBookmarks.length
                });
                continue;
            }

            const insertedByChromeId = new Map<string, InsertedBookmarkRow>(
                (insertedRows as InsertedBookmarkRow[]).map((row) => [
                    row.chrome_id,
                    row
                ])
            );

            // 2b. Pin brand-new bookmarks that already sit in a recognized folder.
            await Promise.all(
                items.map((item) =>
                    limitNotify(async () => {
                        const parentId = item.parentId;
                        if (!parentId) return;
                        const matchedClusterId = clusterIdByChromeFolderId.get(parentId);
                        if (!matchedClusterId) return;
                        const row = insertedByChromeId.get(item.id);
                        if (!row) return;
                        await pinBookmarkToCluster(row.id, matchedClusterId);
                    })
                )
            );

            // 3. Check which shared links already have vectors (one round trip)
            const { data: sharedVectorRows, error: sharedLookupError } =
                await supabase
                    .from('shared_links')
                    .select('id, vector')
                    .in('id', Array.from(sharedRowsById.keys()));

            const cachedHashes = new Set(
                (sharedVectorRows ?? [])
                    .filter((row) => row.vector)
                    .map((row) => row.id)
            );

            const cacheHits: Array<{ item: HashedBookmark; row: InsertedBookmarkRow }> = [];
            const cacheMisses: Array<{ item: HashedBookmark; row: InsertedBookmarkRow }> = [];
            for (const item of items) {
                const row = insertedByChromeId.get(item.id);
                if (!row) {
                    await recordPipelineUntrackedError(
                        userId,
                        jobGeneration,
                        pipelineRunId,
                        clusteringSettings,
                        `bookmark-upsert:${item.id}:${item.urlHash}`
                    );
                    continue;
                }

                if (sharedLookupError) {
                    // Treat the whole chunk as vector lookup failures below.
                    continue;
                }

                if (cachedHashes.has(item.urlHash)) {
                    cacheHits.push({ item, row });
                } else {
                    cacheMisses.push({ item, row });
                }
                saved++;
            }

            if (sharedLookupError) {
                console.error(
                    `[INGEST WORKER] Failed to lookup shared vectors for chunk:`,
                    sharedLookupError
                );
                const failedIds = items
                    .map((item) => insertedByChromeId.get(item.id)?.id)
                    .filter((id): id is string => Boolean(id));
                if (failedIds.length > 0) {
                    await supabase
                        .from('bookmarks')
                        .update({ status: 'error' })
                        .in('id', failedIds);
                    await Promise.all(
                        failedIds.map((bookmarkId) =>
                            limitNotify(() =>
                                notifyPipelineBookmarkTerminal(
                                    userId,
                                    jobGeneration,
                                    pipelineRunId,
                                    bookmarkId,
                                    clusteringSettings
                                )
                            )
                        )
                    );
                }
                await job.updateProgress({
                    processed: handled,
                    total: rawBookmarks.length
                });
                continue;
            }

            // 4a. Cache hits: mark embedded in one round trip, then notify
            if (cacheHits.length > 0) {
                console.log(
                    `[INGEST WORKER] Cache HIT for ${cacheHits.length}/${items.length} bookmarks in chunk`
                );
                const hitIds = cacheHits.map(({ row }) => row.id);
                const { error: embeddedUpdateError } = await supabase
                    .from('bookmarks')
                    .update({ status: 'embedded' })
                    .in('id', hitIds);
                if (embeddedUpdateError) {
                    console.error(
                        `[INGEST WORKER] Failed to mark ${hitIds.length} bookmarks as embedded:`,
                        embeddedUpdateError
                    );
                    await supabase
                        .from('bookmarks')
                        .update({ status: 'error' })
                        .in('id', hitIds);
                }
                await Promise.all(
                    hitIds.map((bookmarkId) =>
                        limitNotify(() =>
                            notifyPipelineBookmarkTerminal(
                                userId,
                                jobGeneration,
                                pipelineRunId,
                                bookmarkId,
                                clusteringSettings
                            )
                        )
                    )
                );
            }

            // 4b. Cache misses: enqueue enrichment
            await Promise.all(
                cacheMisses.map(({ row }) =>
                    limitNotify(() =>
                        queues.enrichment.add(
                            'enrich',
                            {
                                userId,
                                pipelineRunId,
                                jobGeneration,
                                clusteringSettings,
                                bookmarkId: row.id,
                                url: row.url
                            },
                            {
                                jobId: `enrich-${userId}-run-${pipelineRunId || jobGeneration || 'legacy'}-${row.id}`
                            }
                        )
                    )
                )
            );

            await job.updateProgress({
                processed: handled,
                total: rawBookmarks.length
            });
            console.log(
                `[INGEST WORKER] Processed ${handled}/${rawBookmarks.length}`
            );
        }

        await job.updateProgress({
            processed: rawBookmarks.length,
            total: rawBookmarks.length
        });
        console.log(
            `[INGEST WORKER] Done: ${saved} bookmarks saved (${handled} handled), ${unchangedCount} unchanged skipped, ${removedChromeIds.length} removed`
        );

        if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
            console.log(
                `[INGEST WORKER] Cancelled before completing ingest for user ${userId}`
            );
            return;
        }

        await recordPipelineIngestCompleted(
            userId,
            jobGeneration,
            pipelineRunId,
            clusteringSettings
        );
    } catch (error) {
        console.error(`[INGEST WORKER] ERROR:`, error);
        throw error;
    }
};
