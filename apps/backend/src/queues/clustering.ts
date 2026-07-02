import { QueueJob } from '../lib/queue';
import { completePipelineRun, isUserCancelled } from '../lib/cancellation';
import {
    ClusteringSettings,
    getDensityProfile,
    normalizeClusteringSettings
} from '../lib/clusteringSettings';
import {
    recordPipelineClusteringCompleted,
    shouldExecutePipelineClustering,
} from '../lib/pipelineCoordinator';
import {
    computeCentroid,
    computeDistance,
    rankIdsByCentroid,
    shouldAssignLeaf,
    splitClusterGroups
} from './clustering/clusterAlgorithm';
import {
    assignBookmarksToCluster,
    clearUnpinnedAssignmentsAndPruneClusters,
    createCluster,
    fetchPinnedBookmarkIds,
    fetchUserBookmarkVectorRows
} from './clustering/clusterPersistence';
import {
    generateClusterName,
    limitClusterNaming
} from './clustering/clusterNaming';
import { refineSiblingGroupsWithLLM } from './clustering/clusterRefinement';
import {
    normalizeVector,
    parseBookmarkVector
} from './clustering/vectorParsing';

function log(msg: string) {
    console.log(`[CLUSTERING] ${msg}`);
}

export interface ClusteringJobData {
    userId: string;
    clusteringSettings?: ClusteringSettings;
    pipelineRunId?: string;
    jobGeneration?: number;
}

// Folder levels deeper than this get heuristic names instead of AI calls; the
// top levels are what users scan, and this caps total LLM latency per run.
const AI_NAMING_MAX_DEPTH = 2;

// In-memory representation of a cluster; the whole tree (names, keywords,
// and bookmark placement included) is built before anything is written to
// the DB, so a mid-run crash or timeout can't leave a half-organized
// structure behind.
interface ClusterNode {
    name: string;
    keywords: string[];
    bookmarkIds: string[];
    vectors: number[][];
    children: ClusterNode[];
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
    if (typeof jobGeneration === 'number' || pipelineRunId) {
        await recordPipelineClusteringCompleted(
            userId,
            jobGeneration,
            pipelineRunId
        );
    } else {
        log(
            `[CLUSTERING] Missing pipelineRunId and jobGeneration when finalizing run for user ${userId}; skipping pipeline bookkeeping`
        );
    }

    if (!pipelineRunId) {
        log(
            `[CLUSTERING] Missing pipelineRunId when finalizing run for user ${userId}; skipping completePipelineRun`
        );
        return;
    }

    await completePipelineRun(pipelineRunId, totals);
};

/**
 * Builds (or attaches to) the leaf node for a group of bookmarks. When
 * `parentNode` already exists, the bookmarks are merged directly into it;
 * otherwise a brand-new root node is named and returned. Returns [] when the
 * group was merged into an existing parent, or when cancellation stopped the
 * node from being created.
 */
const buildLeafGroup = async (
    bookmarkIds: string[],
    vectors: number[][],
    parentNode: ClusterNode | null,
    userId: string,
    settings: ClusteringSettings,
    pipelineRunId: string | undefined,
    jobGeneration: number | undefined,
    namingOptions: {
        sampledIds?: string[];
        suggestedName?: string;
        allowAI?: boolean;
    } = {}
): Promise<ClusterNode[]> => {
    if (parentNode) {
        if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
            log(
                `[CLUSTERING] Cancelled before assignment write for user ${userId}`
            );
            return [];
        }
        parentNode.bookmarkIds.push(...bookmarkIds);
        parentNode.vectors.push(...vectors);
        return [];
    }

    const { name, keywords } = await generateClusterName(
        bookmarkIds,
        settings,
        log,
        namingOptions
    );
    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(
            `[CLUSTERING] Cancelled before leaf cluster creation for user ${userId}`
        );
        return [];
    }

    return [
        {
            name,
            keywords,
            bookmarkIds: [...bookmarkIds],
            vectors: [...vectors],
            children: []
        }
    ];
};

/**
 * Recursively splits bookmarks into named cluster nodes in memory. Returns
 * newly created root-level nodes (only non-empty when `parentNode` is null);
 * when a parent node is supplied, children are pushed onto it directly.
 */
async function recursiveCluster(
    bookmarkIds: string[],
    vectors: number[][],
    parentNode: ClusterNode | null,
    userId: string,
    settings: ClusteringSettings,
    pipelineRunId?: string,
    jobGeneration?: number,
    depth = 0
): Promise<ClusterNode[]> {
    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(`[CLUSTERING] Cancelled recursion for user ${userId}`);
        return [];
    }

    const profile = getDensityProfile(settings);
    const allowAI = depth < AI_NAMING_MAX_DEPTH;

    if (
        shouldAssignLeaf(bookmarkIds.length, settings) ||
        depth >= profile.maxDepth
    ) {
        return buildLeafGroup(
            bookmarkIds,
            vectors,
            parentNode,
            userId,
            settings,
            pipelineRunId,
            jobGeneration,
            { allowAI }
        );
    }

    // Folders created by this call live at depth + 1; when that is the last
    // allowed level, fan out flat so children never need to recurse deeper.
    const isFinalLevel = depth + 1 >= profile.maxDepth;

    try {
        const splitGroups = splitClusterGroups({
            bookmarkIds,
            vectors,
            settings,
            log,
            uncapChildren: isFinalLevel
        });

        if (!splitGroups) {
            return buildLeafGroup(
                bookmarkIds,
                vectors,
                parentNode,
                userId,
                settings,
                pipelineRunId,
                jobGeneration,
                { allowAI }
            );
        }

        const groups = allowAI
            ? await refineSiblingGroupsWithLLM(splitGroups, settings, log)
            : splitGroups;

        if (groups.length <= 1) {
            const [group] = groups;
            return buildLeafGroup(
                group.ids,
                group.vecs,
                parentNode,
                userId,
                settings,
                pipelineRunId,
                jobGeneration,
                {
                    sampledIds: rankIdsByCentroid(group.ids, group.vecs),
                    suggestedName: group.suggestedName,
                    allowAI
                }
            );
        }

        const namedGroups = await Promise.all(
            groups.map((group) =>
                limitClusterNaming(async () => {
                    const representativeIds = rankIdsByCentroid(
                        group.ids,
                        group.vecs
                    );
                    const { name, keywords } = await generateClusterName(
                        group.ids,
                        settings,
                        log,
                        {
                            sampledIds: representativeIds,
                            suggestedName: group.suggestedName,
                            allowAI
                        }
                    );
                    const cancelled = await isUserCancelled(
                        userId,
                        jobGeneration,
                        pipelineRunId
                    );
                    return { name, keywords, group, cancelled };
                })
            )
        );

        const createdRoots = await Promise.all(
            namedGroups.map(async ({ name, keywords, group, cancelled }) => {
                if (cancelled) {
                    return buildLeafGroup(
                        group.ids,
                        group.vecs,
                        parentNode,
                        userId,
                        settings,
                        pipelineRunId,
                        jobGeneration,
                        { allowAI }
                    );
                }

                const node: ClusterNode = {
                    name,
                    keywords,
                    bookmarkIds: [],
                    vectors: [],
                    children: []
                };
                if (parentNode) {
                    parentNode.children.push(node);
                }

                await recursiveCluster(
                    group.ids,
                    group.vecs,
                    node,
                    userId,
                    settings,
                    pipelineRunId,
                    jobGeneration,
                    depth + 1
                );

                return parentNode ? [] : [node];
            })
        );

        return createdRoots.flat();
    } catch (e: any) {
        log(`Clustering error: ${e}`);
        return buildLeafGroup(
            bookmarkIds,
            vectors,
            parentNode,
            userId,
            settings,
            pipelineRunId,
            jobGeneration,
            { allowAI }
        );
    }
}

/**
 * Writes the fully-built in-memory tree to the DB in one pass: each node is
 * created before its children so `parent_id` is always available, and a
 * node's own bookmarks are assigned right after it's created.
 */
async function persistClusterTree(
    userId: string,
    nodes: ClusterNode[]
): Promise<void> {
    const persistNode = async (
        node: ClusterNode,
        parentId: string | null
    ): Promise<void> => {
        const clusterId = await createCluster(
            userId,
            parentId,
            node.name,
            node.keywords,
            log
        );
        if (!clusterId) {
            log(
                `[CLUSTERING] Unable to persist cluster "${node.name}" for user ${userId}: creation failed`
            );
            return;
        }

        if (node.bookmarkIds.length > 0) {
            const distanceById = new Map<string, number>();
            if (
                node.vectors.length === node.bookmarkIds.length &&
                node.vectors.length > 0
            ) {
                const centroid = computeCentroid(node.vectors);
                node.bookmarkIds.forEach((id, index) => {
                    distanceById.set(
                        id,
                        computeDistance(node.vectors[index], centroid)
                    );
                });
            }

            const assignmentResult = await assignBookmarksToCluster(
                node.bookmarkIds,
                clusterId,
                log,
                distanceById
            );
            if (!assignmentResult.success) {
                log(
                    `[CLUSTERING] Partial assignment failure for cluster ${clusterId}: inserted ${assignmentResult.inserted}/${assignmentResult.total}, failed ${assignmentResult.failed}`
                );
            }
        }

        await Promise.all(
            node.children.map((child) => persistNode(child, clusterId))
        );
    };

    await Promise.all(nodes.map((node) => persistNode(node, null)));
}

export const clusteringProcessor = async (job: QueueJob<ClusteringJobData>) => {
    const { userId } = job.data;
    const { pipelineRunId, jobGeneration } = job.data;
    const settings = normalizeClusteringSettings(job.data.clusteringSettings);
    log(
        `Clustering bookmarks for user ${userId} (density=${settings.folderDensity}, tone=${settings.namingTone}, emoji=${settings.useEmojiNames})`
    );

    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(`[CLUSTERING] Cancelled before start for user ${userId}`);
        return;
    }

    if (!(await shouldExecutePipelineClustering(userId, jobGeneration, pipelineRunId))) {
        log(
            `[CLUSTERING] Skipping clustering for user ${userId}: enqueue was not recorded (orphaned or superseded job)`
        );
        return;
    }

    // Pinned bookmarks (manually placed by the user, confirmed via Apply) are
    // never touched by this run: their assignment is excluded from the clear
    // below and from the vectors fed into the algorithm.
    const pinnedBookmarkIds = await fetchPinnedBookmarkIds(userId, log);

    const clearedUnpinned = await clearUnpinnedAssignmentsAndPruneClusters(
        userId,
        log
    );
    if (!clearedUnpinned) {
        throw new Error(
            `Failed to clear unpinned cluster assignments for user ${userId}`
        );
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
        if (pinnedBookmarkIds.has(bookmark.id)) continue;

        const parsedVector = parseVectorWithLogging(bookmark.shared_links);
        if (!parsedVector) continue;

        parsedRows.push({
            id: bookmark.id,
            vector: normalizeVector(parsedVector)
        });
    }

    // Canonical ordering keeps k-means seeding (and therefore the whole tree)
    // stable across runs on the same collection.
    parsedRows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    log(`Valid bookmarks with vectors: ${parsedRows.length}`);

    if (parsedRows.length === 0) {
        log('No valid bookmarks with vectors found');
        await finalizePipelineRun(userId, jobGeneration, pipelineRunId, {
            totalBookmarks: userBookmarks.length,
            embeddedBookmarks: 0,
            assignedBookmarks: pinnedBookmarkIds.size
        });
        return;
    }

    const ids = parsedRows.map((row) => row.id);
    const vectors = parsedRows.map((row) => row.vector);

    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(`[CLUSTERING] Cancelled before writes for user ${userId}`);
        return;
    }

    const clusterTree = await recursiveCluster(
        ids,
        vectors,
        null,
        userId,
        settings,
        pipelineRunId,
        jobGeneration
    );

    if (await isUserCancelled(userId, jobGeneration, pipelineRunId)) {
        log(
            `[CLUSTERING] Cancelled before persisting cluster tree for user ${userId}`
        );
        return;
    }

    await persistClusterTree(userId, clusterTree);

    await finalizePipelineRun(userId, jobGeneration, pipelineRunId, {
        totalBookmarks: userBookmarks.length,
        embeddedBookmarks: parsedRows.length,
        assignedBookmarks: pinnedBookmarkIds.size + ids.length
    });
    log('Clustering completed');
};
