import { Worker, Job } from 'bullmq';
import { connection } from '../queue/connection';
import { QUEUE_NAMES } from '../queue/queues';
import { OpenAIService } from '../services/openai';
import { query } from '../db/client';
// @ts-ignore
// import { kmeans } from 'ml-kmeans';
// @ts-ignore
import pgvector from 'pgvector/pg';

const openai = new OpenAIService();

// Constants for clustering
// Default constants for clustering (fallback)
const DEFAULT_TARGET_SIZE = 15;
const DEFAULT_MAX_SIZE = 30;
const DEFAULT_MIN_SIZE = 5;

interface ClusteringConfig {
    targetSize: number;
    maxSize: number;
    minSize: number;
}

interface ClusterNode {
    id: string;
    children: ClusterNode[];
    items: number[]; // Indices of bookmarks in the original array
    centroid: number[];
    isLeaf: boolean;
    name?: string;
}

// Helper: Normalize vector to unit length
function normalizeVector(v: number[]): number[] {
    const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return v;
    return v.map(val => val / norm);
}

// Helper: Cosine similarity (dot product of normalized vectors)
function cosineSimilarity(v1: number[], v2: number[]): number {
    return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
}

// Recursive function to split clusters until they fit capacity constraints
async function recursiveCluster(
    bookmarkIndices: number[],
    allVectors: number[][],
    depth: number,
    config: ClusteringConfig
): Promise<ClusterNode> {
    const size = bookmarkIndices.length;
    const nodeUuid = crypto.randomUUID();

    // Calculate centroid for this node
    const nodeVectors = bookmarkIndices.map(i => allVectors[i]);
    const centroid = nodeVectors[0].map((_, colIndex) =>
        nodeVectors.reduce((sum, vec) => sum + vec[colIndex], 0) / size
    );
    const normalizedCentroid = normalizeVector(centroid);

    // Base case: if size fits within MAX, return as leaf
    // Also stop if we are too deep to prevent infinite recursion
    // Base case: if size fits within MAX, return as leaf
    // Also stop if we are too deep to prevent infinite recursion
    if (size <= config.maxSize || depth > 5) {
        if (depth > 5) {
            console.log(`[Clustering] Max depth reached for node with ${size} items. Forcing leaf.`);
        }
        return {
            id: nodeUuid,
            children: [],
            items: bookmarkIndices,
            centroid: normalizedCentroid,
            isLeaf: true
        };
    }

    // Determine number of children
    const K_child = Math.ceil(size / config.targetSize);

    console.log(`[Clustering] Splitting node with ${size} items into ${K_child} children (Depth ${depth})`);

    // Run K-Means
    // @ts-ignore
    const { kmeans } = await import('ml-kmeans');
    // We use the subset of vectors for this cluster
    const result = kmeans(nodeVectors, K_child, { initialization: 'kmeans++' });

    // Group indices by new cluster assignment
    const childrenIndices: number[][] = Array.from({ length: K_child }, () => []);
    result.clusters.forEach((clusterId: number, index: number) => {
        childrenIndices[clusterId].push(bookmarkIndices[index]);
    });

    // Recursively create children nodes
    const children: ClusterNode[] = [];
    for (const indices of childrenIndices) {
        if (indices.length === 0) continue;
        const childNode = await recursiveCluster(indices, allVectors, depth + 1, config);
        children.push(childNode);
    }

    console.log(`[Clustering] Node split into ${children.length} children`);

    // If k-means failed to split (e.g. all identical vectors), force a leaf
    if (children.length <= 1) {
        console.log(`[Clustering] Failed to split node (only ${children.length} children), forcing leaf.`);
        return {
            id: nodeUuid,
            children: [],
            items: bookmarkIndices,
            centroid: normalizedCentroid,
            isLeaf: true
        };
    }

    return {
        id: nodeUuid,
        children: children,
        items: [], // Internal nodes don't hold items directly in this model
        centroid: normalizedCentroid,
        isLeaf: false
    };
}

// Merge undersized leaf clusters
function mergeUndersizedClusters(root: ClusterNode, config: ClusteringConfig): void {
    // Collect all leaf nodes
    const leaves: ClusterNode[] = [];

    function traverse(node: ClusterNode) {
        if (node.isLeaf) {
            leaves.push(node);
        } else {
            node.children.forEach(traverse);
        }
    }
    traverse(root);

    // Simple greedy merge
    // Note: This modifies the tree structure in place. 
    // A full implementation would need to handle parent pointers to actually move nodes.
    // For simplicity in this pass, we will just mark them for merging and handle it 
    // when we flatten the tree or we can do a global pass on leaves.

    // Better approach for this specific requirement:
    // We can't easily modify the tree structure without parent pointers.
    // So we will collect leaves, merge them logically, and then when generating paths,
    // we will treat merged leaves as one.

    // However, the prompt asks to "Merge undersized clusters".
    // Let's implement a pass that iterates through leaves and if one is small, 
    // finds the nearest other leaf and merges them if combined size <= MAX.

    const activeLeaves = new Set(leaves);
    let merged = true;

    while (merged) {
        merged = false;
        const sortedLeaves = Array.from(activeLeaves).sort((a, b) => a.items.length - b.items.length);

        for (const leaf of sortedLeaves) {
            if (!activeLeaves.has(leaf)) continue;

            if (leaf.items.length < config.minSize) {
                // Find nearest neighbor
                let bestNeighbor: ClusterNode | null = null;
                let maxSim = -1;

                for (const other of activeLeaves) {
                    if (leaf === other) continue;

                    const sim = cosineSimilarity(leaf.centroid, other.centroid);
                    if (sim > maxSim) {
                        maxSim = sim;
                        bestNeighbor = other;
                    }
                }

                if (bestNeighbor && (leaf.items.length + bestNeighbor.items.length <= config.maxSize)) {
                    // Merge leaf into bestNeighbor
                    bestNeighbor.items.push(...leaf.items);

                    // Recompute centroid for bestNeighbor
                    // (Approximation: weighted average of centroids would be faster, 
                    // but we don't have the original vectors easily accessible here without passing them around.
                    // For now, let's just keep the neighbor's centroid or update it if we had vectors.)

                    // Remove leaf from active set
                    activeLeaves.delete(leaf);
                    merged = true;
                    // Restart loop to re-sort and re-evaluate
                    break;
                }
            }
        }
    }

    // After merging, we need to make sure the tree structure reflects this.
    // But since we only have a tree of nodes, and we modified 'items' of some leaves
    // and effectively deleted others, we need a way to reconstruct the valid nodes.
    // The 'activeLeaves' set contains the valid leaves.
    // We can mark 'isDeleted' on nodes that were merged.

    leaves.forEach(l => {
        if (!activeLeaves.has(l)) {
            (l as any).isDeleted = true;
        }
    });
}

// Helper: Recursively collect sample items from a node (leaf or internal)
function collectSamples(node: ClusterNode, count: number): number[] {
    if (node.isLeaf) {
        return node.items.slice(0, count);
    }

    let samples: number[] = [];
    for (const child of node.children) {
        if (samples.length >= count) break;
        const childSamples = collectSamples(child, count - samples.length);
        samples = samples.concat(childSamples);
    }
    return samples;
}


// Assign clusters to DB and generate names
async function assignClusters(
    node: ClusterNode,
    userId: string,
    parentId: string | null,
    bookmarks: any[],
    depth: number,
    job?: any
): Promise<void> {
    // Skip deleted nodes (from merging)
    if ((node as any).isDeleted) return;

    // Generate name if not present (root might not need one, but top level clusters do)
    // Generate name if not present (root might not need one, but top level clusters do)
    let clusterName = node.name;
    if (!clusterName && depth >= 0) {
        // Get representative bookmarks recursively
        const sampleIndices = collectSamples(node, 5);

        if (sampleIndices.length === 0) {
            clusterName = 'Miscellaneous';
        } else {
            const samples = sampleIndices.map(idx => bookmarks[idx]).map((b: any) => `- ${b.title} (${b.url})`).join('\n');

            const depthContext = depth === 0 ? 'top-level category' : 'sub-category';
            const prompt = `
Analyze these bookmarks and provide a short, descriptive ${depthContext} name (e.g., "Web Development", "Italian Recipes").
Return ONLY the name, maximum 4 words. Do not use quotes or punctuation.
Do not include conversational text like "Sure" or "Here is the name".
If the bookmarks are too diverse or unclear, return "General".

Bookmarks:
${samples}
            `.trim();

            const name = await openai.generateChatCompletion(prompt);
            clusterName = name.replace(/"/g, '').trim();

            // Safety check for conversational failure
            if (clusterName.length > 50 || clusterName.includes('\n')) {
                console.warn(`[Clustering] Generated name too long/complex: "${clusterName}". Fallback to "Category".`);
                clusterName = 'Category';
            }
        }
    }

    // Save cluster to DB
    // Note: Root node (depth -1) usually isn't saved as a cluster, but its children are top-level.
    // However, our recursive function returns a tree where the top calls might be the top-level clusters.
    // Let's assume the caller handles the "Root" concept or we treat the first level as top-level.

    // In this implementation, we will treat the nodes passed here as actual clusters to be created.

    const centroidStr = pgvector.toSql(node.centroid.map((v: number) => Number(v)));

    await query(
        `INSERT INTO clusters (id, user_id, name, centroid, parent_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [node.id, userId, clusterName || 'Uncategorized', centroidStr, parentId]
    );

    console.log(`[Clustering] Level ${depth}: Created cluster "${clusterName}" with ${node.items.length} items`);

    if (job) {
        await job.updateProgress({
            phase: 'clustering',
            message: `Created "${clusterName}"...`,
        });
    }

    // If leaf, update bookmarks
    if (node.isLeaf) {
        for (const idx of node.items) {
            const bookmark = bookmarks[idx];
            await query(
                `UPDATE bookmarks SET cluster_id = $1 WHERE id = $2`,
                [node.id, bookmark.id]
            );
        }
    } else {
        // Recurse for children
        for (const child of node.children) {
            await assignClusters(child, userId, node.id, bookmarks, depth + 1, job);
        }
    }
}

export const clusteringWorker = new Worker(
    QUEUE_NAMES.CLUSTERING,
    async (job: Job) => {
        const { userId, settings } = job.data;
        console.log(`[Clustering] Starting for user ${userId}`);

        // Extract clustering config from settings or use defaults
        const config: ClusteringConfig = {
            targetSize: settings?.clustering?.targetSize || DEFAULT_TARGET_SIZE,
            maxSize: settings?.clustering?.maxSize || DEFAULT_MAX_SIZE,
            minSize: settings?.clustering?.minSize || DEFAULT_MIN_SIZE
        };
        console.log(`[Clustering] Config: Target=${config.targetSize}, Max=${config.maxSize}, Min=${config.minSize}`);

        // 1. Fetch all embeddings for user
        const res = await query(
            `SELECT b.id, b.title, b.url, e.vector 
       FROM bookmarks b
       JOIN embeddings e ON b.id = e.bookmark_id
       WHERE b.user_id = $1 AND b.status = 'EMBEDDED'`,
            [userId]
        );

        let bookmarks = res.rows;

        // Check total bookmarks to determine if we should wait for more embeddings
        const totalRes = await query(
            `SELECT COUNT(*) as count FROM bookmarks WHERE user_id = $1 AND status != 'BROKEN'`,
            [userId]
        );
        const totalBookmarks = parseInt(totalRes.rows[0].count);

        // Report progress
        await job.updateProgress({
            phase: 'waiting_for_embeddings',
            embedded: bookmarks.length,
            total: totalBookmarks
        });

        // CRITICAL FIX: Wait for ALL embeddings to complete (not just 5)
        // Only proceed if we have at least 90% of bookmarks embedded
        const embeddingPercentage = totalBookmarks > 0 ? (bookmarks.length / totalBookmarks) * 100 : 0;

        if (embeddingPercentage < 90 && totalBookmarks > 0) {
            console.log(`[Clustering] Only ${bookmarks.length}/${totalBookmarks} bookmarks embedded (${embeddingPercentage.toFixed(1)}%). Waiting for more embeddings...`);
            throw new Error(`Waiting for embeddings to complete: ${bookmarks.length}/${totalBookmarks}`);
        }

        console.log(`[Clustering] ${bookmarks.length}/${totalBookmarks} bookmarks embedded (${embeddingPercentage.toFixed(1)}%). Proceeding with clustering.`);

        // Apply Premium Limit
        if (settings?.isPremium === false && bookmarks.length > 500) {
            console.log(`[Clustering] User is not premium. Limiting to first 500 bookmarks.`);
            bookmarks = bookmarks.slice(0, 500);
        }

        if (bookmarks.length < 5) {
            // Check if we have errors
            const errorRes = await query(
                `SELECT COUNT(*) as count FROM bookmarks WHERE user_id = $1 AND status = 'ERROR'`,
                [userId]
            );
            const errorCount = parseInt(errorRes.rows[0].count);

            if (errorCount > 0) {
                throw new Error(`Analysis failed: ${errorCount} bookmarks failed to process (likely API Quota or Network issues).`);
            }

            console.log('[Clustering] Not enough bookmarks to cluster.');
            return;
        }

        // Update progress to clustering phase
        await job.updateProgress({
            phase: 'clustering',
            embedded: bookmarks.length,
            total: totalBookmarks
        });

        // 2. Prepare data for K-Means
        // pgvector returns string "[1,2,3]", need to parse
        const rawVectors = bookmarks.map(b => JSON.parse(b.vector));

        // Normalize vectors
        const vectors = rawVectors.map(v => normalizeVector(v));

        // Clear old clusters for this user
        console.log(`[Clustering] Deleting old clusters for user ${userId}`);
        await query(`DELETE FROM clusters WHERE user_id = $1`, [userId]);

        // 3. Top level clustering
        const N = bookmarks.length;
        const K_top = Math.max(5, Math.min(50, Math.round(N / config.targetSize)));

        console.log(`[Clustering] Top level: ${N} items into ${K_top} clusters`);

        // @ts-ignore
        const { kmeans } = await import('ml-kmeans');
        const result = kmeans(vectors, K_top, { initialization: 'kmeans++' });

        // Group into top level clusters
        const topLevelIndices: number[][] = Array.from({ length: K_top }, () => []);
        result.clusters.forEach((clusterId: number, index: number) => {
            topLevelIndices[clusterId].push(index);
        });

        // 4. Recursive splitting
        const rootChildren: ClusterNode[] = [];

        for (let k = 0; k < K_top; k++) {
            const indices = topLevelIndices[k];
            if (indices.length === 0) continue;

            const node = await recursiveCluster(indices, vectors, 0, config);
            rootChildren.push(node);
        }

        // Create a virtual root to hold everything
        const root: ClusterNode = {
            id: 'root', // Placeholder, won't be saved
            children: rootChildren,
            items: [],
            centroid: [],
            isLeaf: false
        };

        // 5. Merge undersized clusters
        await job.updateProgress({
            phase: 'clustering',
            message: 'Optimizing cluster sizes...',
            progress: 80
        });
        mergeUndersizedClusters(root, config);

        // 6. Assign and Name
        await job.updateProgress({
            phase: 'clustering',
            message: 'Naming categories...',
            progress: 90
        });

        // We iterate over root children to save them as top-level clusters
        for (const child of root.children) {
            await assignClusters(child, userId, null, bookmarks, 0, job);
        }

        await job.updateProgress({
            phase: 'complete',
            message: 'Finalizing structure...',
            progress: 100
        });

        console.log(`[Clustering] Completed for user ${userId}`);
    },
    { connection, concurrency: 1 } // Sequential per user is safer for now
);
