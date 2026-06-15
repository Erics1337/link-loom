import { kmeans } from 'ml-kmeans';
import {
    ClusteringDensityProfile,
    ClusteringSettings,
    getDensityProfile
} from '../../lib/clusteringSettings';

export interface ClusterGroup {
    ids: string[];
    vecs: number[][];
    suggestedName?: string;
}

export interface SplitClusterGroupsOptions {
    bookmarkIds: string[];
    vectors: number[][];
    settings: ClusteringSettings;
    log: (msg: string) => void;
}

const chooseSplitK = (
    count: number,
    profile: ClusteringDensityProfile
): number => {
    if (count <= profile.targetLeafSize) return 1;

    const estimated = Math.ceil(count / profile.targetLeafSize);
    return Math.max(2, Math.min(profile.maxChildren, estimated, count));
};

export const computeDistance = (a: number[], b: number[]): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return sum;
};

export const computeCentroid = (vecs: number[][]): number[] => {
    if (vecs.length === 0) {
        throw new Error('computeCentroid requires at least one vector');
    }
    if (vecs.length === 1) return vecs[0];

    const dimensions = vecs[0].length;
    const centroid = new Array(dimensions).fill(0);
    for (const vec of vecs) {
        for (let i = 0; i < dimensions; i++) {
            centroid[i] += vec[i];
        }
    }
    return centroid.map((v) => v / vecs.length);
};

const MAX_REFINEMENT_PASSES = 2;
const OUTLIER_MOVE_DISTANCE_RATIO = 0.72;
const MIN_ABSOLUTE_DISTANCE_IMPROVEMENT = 0.04;

const removeAt = <T>(items: T[], index: number) => {
    const [item] = items.splice(index, 1);
    return item;
};

const maxChildSizeForRefinement = (profile: ClusteringDensityProfile) =>
    Math.max(profile.targetLeafSize * 2, profile.targetLeafSize + profile.minChildSize);

export const rankIdsByCentroid = (
    ids: string[],
    vecs: number[][],
    limit = ids.length
): string[] => {
    if (ids.length === 0 || vecs.length === 0) return [];

    const centroid = computeCentroid(vecs);
    return ids
        .map((id, index) => ({
            id,
            distance: computeDistance(vecs[index], centroid)
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((item) => item.id);
};

const refineOutlierAssignments = (
    groups: ClusterGroup[],
    profile: ClusteringDensityProfile,
    log: (msg: string) => void
): ClusterGroup[] => {
    if (groups.length <= 1) return groups;

    const maxChildSize = maxChildSizeForRefinement(profile);
    let moveCount = 0;

    for (let pass = 0; pass < MAX_REFINEMENT_PASSES; pass++) {
        let movedThisPass = false;
        const centroids = groups.map((group) => computeCentroid(group.vecs));

        for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex++) {
            const source = groups[sourceIndex];
            if (source.ids.length <= profile.minChildSize) continue;

            for (let itemIndex = source.ids.length - 1; itemIndex >= 0; itemIndex--) {
                const vec = source.vecs[itemIndex];
                const ownDistance = computeDistance(vec, centroids[sourceIndex]);
                let bestTargetIndex = -1;
                let bestTargetDistance = ownDistance;

                for (let targetIndex = 0; targetIndex < groups.length; targetIndex++) {
                    if (targetIndex === sourceIndex) continue;
                    const target = groups[targetIndex];
                    if (target.ids.length >= maxChildSize) continue;

                    const targetDistance = computeDistance(vec, centroids[targetIndex]);
                    if (targetDistance < bestTargetDistance) {
                        bestTargetIndex = targetIndex;
                        bestTargetDistance = targetDistance;
                    }
                }

                const improvement = ownDistance - bestTargetDistance;
                const isMeaningfullyCloser =
                    bestTargetIndex >= 0 &&
                    bestTargetDistance <= ownDistance * OUTLIER_MOVE_DISTANCE_RATIO &&
                    improvement >= MIN_ABSOLUTE_DISTANCE_IMPROVEMENT;

                if (!isMeaningfullyCloser) continue;
                if (source.ids.length - 1 < profile.minChildSize) continue;

                const id = removeAt(source.ids, itemIndex);
                const movedVec = removeAt(source.vecs, itemIndex);
                groups[bestTargetIndex].ids.push(id);
                groups[bestTargetIndex].vecs.push(movedVec);
                movedThisPass = true;
                moveCount++;
            }
        }

        if (!movedThisPass) break;
    }

    if (moveCount > 0) {
        log(`Refined ${moveCount} outlier bookmark assignment${moveCount === 1 ? '' : 's'} after k-means`);
    }

    return groups;
};

const rebalanceSmallGroups = (
    groups: ClusterGroup[],
    minChildSize: number
): ClusterGroup[] => {
    if (groups.length <= 1) return groups;

    const largeGroups = groups.filter(
        (group) => group.ids.length >= minChildSize
    );
    const smallGroups = groups.filter(
        (group) => group.ids.length < minChildSize
    );

    if (smallGroups.length === 0 || largeGroups.length === 0) {
        return groups;
    }

    const largeGroupCentroids = largeGroups.map((g) => computeCentroid(g.vecs));

    for (const small of smallGroups) {
        for (let i = 0; i < small.ids.length; i++) {
            const id = small.ids[i];
            const vec = small.vecs[i];

            let closestIdx = 0;
            let minDistance = Infinity;

            for (let j = 0; j < largeGroups.length; j++) {
                const distance = computeDistance(vec, largeGroupCentroids[j]);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestIdx = j;
                }
            }

            largeGroups[closestIdx].ids.push(id);
            largeGroups[closestIdx].vecs.push(vec);
            largeGroupCentroids[closestIdx] = computeCentroid(
                largeGroups[closestIdx].vecs
            );
        }
    }

    return largeGroups;
};

export const shouldAssignLeaf = (
    bookmarkCount: number,
    settings: ClusteringSettings
): boolean => {
    const profile = getDensityProfile(settings);
    return bookmarkCount <= profile.targetLeafSize;
};

export const splitClusterGroups = ({
    bookmarkIds,
    vectors,
    settings,
    log
}: SplitClusterGroupsOptions): ClusterGroup[] | null => {
    const profile = getDensityProfile(settings);
    const k = chooseSplitK(bookmarkIds.length, profile);
    if (k < 2) return null;

    log(`Running k-means on ${bookmarkIds.length} items with k=${k}`);
    const result = kmeans(vectors, k, { initialization: 'kmeans++' });

    const groupsByCluster: Record<number, ClusterGroup> = {};
    for (let i = 0; i < result.clusters.length; i++) {
        const clusterIdx = result.clusters[i];
        if (!groupsByCluster[clusterIdx]) {
            groupsByCluster[clusterIdx] = { ids: [], vecs: [] };
        }

        groupsByCluster[clusterIdx].ids.push(bookmarkIds[i]);
        groupsByCluster[clusterIdx].vecs.push(vectors[i]);
    }

    const groups = rebalanceSmallGroups(
        Object.values(groupsByCluster),
        profile.minChildSize
    );

    const refinedGroups = refineOutlierAssignments(groups, profile, log);

    return refinedGroups.length > 1 ? refinedGroups : null;
};
