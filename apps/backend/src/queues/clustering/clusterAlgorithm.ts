import { kmeans } from 'ml-kmeans';
import {
    ClusteringDensityProfile,
    ClusteringSettings,
    getDensityProfile
} from '../../lib/clusteringSettings';

export interface ClusterGroup {
    ids: string[];
    vecs: number[][];
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

const computeDistance = (a: number[], b: number[]): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return sum;
};

const computeCentroid = (vecs: number[][]): number[] => {
    if (vecs.length === 0) return [];
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

    return groups.length > 1 ? groups : null;
};
