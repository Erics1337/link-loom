import fs from 'fs';
import path from 'path';

import { QueueJob } from '../lib/queue';
import { completePipelineRun, isUserCancelled } from '../lib/cancellation';
import {
    ClusteringSettings,
    normalizeClusteringSettings
} from '../lib/clusteringSettings';
import { recordPipelineClusteringCompleted } from '../lib/pipelineCoordinator';
import {
    shouldAssignLeaf,
    splitClusterGroups
} from './clustering/clusterAlgorithm';
import {
    assignBookmarksToCluster,
    createCluster,
    fetchUserBookmarkVectorRows
} from './clustering/clusterPersistence';
import {
    generateClusterName,
    limitClusterNaming
} from './clustering/clusterNaming';
import {
    normalizeVector,
    parseBookmarkVector
} from './clustering/vectorParsing';

const logFile = path.resolve(process.cwd(), 'clustering-debug.log');

function log(msg: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
    console.log(msg);
}

export interface ClusteringJobData {
    userId: string;
    clusteringSettings?: ClusteringSettings;
    pipelineRunId?: string;
    jobGeneration?: number;
}

const parseVectorWithLogging = (joined: unknown): number[] | null =>
    parseBookmarkVector(joined, (e) => log(`Failed to parse vector JSON: ${e}`));

const finalizePipelineRun = async (
    userId: string,
    jobGeneration: number | undefined,
    pipelineRunId: string | undefined,
    totals: {
        totalBookmarks: number;
        embeddedBookmarks: number;
        assignedBookmarks: number;
    }
) => {
    await recordPipelineClusteringCompleted(
        userId,
        jobGeneration,
        pipelineRunId
    );
    await completePipelineRun(pipelineRunId ?? '', totals);
};

const assignLeafGroup = async (
    bookmarkIds: string[],
    parentId: string | null,
    userId: string,
    settings: ClusteringSettings,
    pipelineRunId?: string,
    jobGeneration?: number
) => {
    let leafClusterId = parentId;

    if (!leafClusterId) {
        const fallbackName = await generateClusterName(
            bookmarkIds,
            settings,
            log
        );
        if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
            log(
                `[CLUSTERING] Cancelled before leaf cluster creation for user ${userId}`
            );
            return;
        }
        leafClusterId = await createCluster(userId, null, fallbackName, log);
    }

    if (!leafClusterId) {
        log(
            `Unable to assign ${bookmarkIds.length} bookmarks for user ${userId}: no target cluster`
        );
        return;
    }

    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(
            `[CLUSTERING] Cancelled before assignment write for user ${userId}`
        );
        return;
    }

    await assignBookmarksToCluster(bookmarkIds, leafClusterId, log);
};

async function recursiveCluster(
    bookmarkIds: string[],
    vectors: number[][],
    parentId: string | null,
    userId: string,
    settings: ClusteringSettings,
    pipelineRunId?: string,
    jobGeneration?: number
) {
    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(`[CLUSTERING] Cancelled recursion for user ${userId}`);
        return;
    }

    if (shouldAssignLeaf(bookmarkIds.length, settings)) {
        await assignLeafGroup(
            bookmarkIds,
            parentId,
            userId,
            settings,
            pipelineRunId,
            jobGeneration
        );
        return;
    }

    try {
        const groups = splitClusterGroups({
            bookmarkIds,
            vectors,
            settings,
            log
        });

        if (!groups) {
            await assignLeafGroup(
                bookmarkIds,
                parentId,
                userId,
                settings,
                pipelineRunId,
                jobGeneration
            );
            return;
        }

        const createdClusters = await Promise.all(
            groups.map((group) =>
                limitClusterNaming(async () => {
                    const name = await generateClusterName(
                        group.ids,
                        settings,
                        log
                    );
                    if (
                        await isUserCancelled(
                            userId,
                            jobGeneration,
                            pipelineRunId
                        )
                    ) {
                        return { clusterId: null, group };
                    }

                    const clusterId = await createCluster(
                        userId,
                        parentId,
                        name,
                        log
                    );
                    return { clusterId, group };
                })
            )
        );

        await Promise.all(
            createdClusters.map(async (item) => {
                if (!item.clusterId) {
                    await assignLeafGroup(
                        item.group.ids,
                        parentId,
                        userId,
                        settings,
                        pipelineRunId,
                        jobGeneration
                    );
                    return;
                }

                await recursiveCluster(
                    item.group.ids,
                    item.group.vecs,
                    item.clusterId,
                    userId,
                    settings,
                    pipelineRunId,
                    jobGeneration
                );
            })
        );
    } catch (e: any) {
        log(`Clustering error: ${e}`);
        await assignLeafGroup(
            bookmarkIds,
            parentId,
            userId,
            settings,
            pipelineRunId,
            jobGeneration
        );
    }
}

export const clusteringProcessor = async (job: QueueJob<ClusteringJobData>) => {
    const { userId } = job.data;
    const { pipelineRunId, jobGeneration } = job.data;
    const settings = normalizeClusteringSettings(job.data.clusteringSettings);
    log(
        `Clustering bookmarks for user ${userId} (density=${settings.folderDensity}, tone=${settings.namingTone}, mode=${settings.organizationMode}, emoji=${settings.useEmojiNames})`
    );

    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(`[CLUSTERING] Cancelled before start for user ${userId}`);
        return;
    }

    const fetchResult = await fetchUserBookmarkVectorRows(
        userId,
        () => isUserCancelled(userId, jobGeneration, pipelineRunId),
        log
    );
    if (fetchResult.status === 'cancelled') {
        return;
    }
    if (fetchResult.status === 'error') {
        const message =
            fetchResult.error &&
            typeof fetchResult.error === 'object' &&
            'message' in fetchResult.error &&
            typeof fetchResult.error.message === 'string'
                ? fetchResult.error.message
                : JSON.stringify(fetchResult.error);
        throw new Error(`Failed to fetch bookmarks for clustering: ${message}`);
    }

    const userBookmarks = fetchResult.rows;

    if (userBookmarks.length === 0) {
        log('No user bookmarks found');
        await finalizePipelineRun(userId, jobGeneration, pipelineRunId, {
            totalBookmarks: 0,
            embeddedBookmarks: 0,
            assignedBookmarks: 0
        });
        return;
    }

    log(`Fetched ${userBookmarks.length} bookmarks from DB`);

    const parsedRows: Array<{ id: string; vector: number[] }> = [];
    for (const bookmark of userBookmarks) {
        const parsedVector = parseVectorWithLogging(bookmark.shared_links);
        if (!parsedVector) continue;

        parsedRows.push({
            id: bookmark.id,
            vector: normalizeVector(parsedVector)
        });
    }

    log(`Valid bookmarks with vectors: ${parsedRows.length}`);

    if (parsedRows.length === 0) {
        log('No valid bookmarks with vectors found');
        await finalizePipelineRun(userId, jobGeneration, pipelineRunId, {
            totalBookmarks: userBookmarks.length,
            embeddedBookmarks: 0,
            assignedBookmarks: 0
        });
        return;
    }

    const ids = parsedRows.map((row) => row.id);
    const vectors = parsedRows.map((row) => row.vector);

    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(`[CLUSTERING] Cancelled before writes for user ${userId}`);
        return;
    }

    await recursiveCluster(
        ids,
        vectors,
        null,
        userId,
        settings,
        pipelineRunId,
        jobGeneration
    );
    await finalizePipelineRun(userId, jobGeneration, pipelineRunId, {
        totalBookmarks: userBookmarks.length,
        embeddedBookmarks: parsedRows.length,
        assignedBookmarks: ids.length
    });
    log('Clustering completed');
};
