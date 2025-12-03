"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clusteringWorker = void 0;
const bullmq_1 = require("bullmq");
const connection_1 = require("../queue/connection");
const queues_1 = require("../queue/queues");
const openai_1 = require("../services/openai");
const client_1 = require("../db/client");
// @ts-ignore
// import { kmeans } from 'ml-kmeans';
// @ts-ignore
const pg_1 = __importDefault(require("pgvector/pg"));
const openai = new openai_1.OpenAIService();
// Constants for clustering
const TARGET_SIZE = 40; // T: target bookmarks per folder
const MAX_SIZE = 70; // MAX: hard max per folder
const MIN_SIZE = 8; // MIN: minimum useful folder size
// Helper: Normalize vector to unit length
function normalizeVector(v) {
    const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0)
        return v;
    return v.map(val => val / norm);
}
// Helper: Cosine similarity (dot product of normalized vectors)
function cosineSimilarity(v1, v2) {
    return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
}
// Recursive function to split clusters until they fit capacity constraints
async function recursiveCluster(bookmarkIndices, allVectors, depth) {
    const size = bookmarkIndices.length;
    const nodeUuid = crypto.randomUUID();
    // Calculate centroid for this node
    const nodeVectors = bookmarkIndices.map(i => allVectors[i]);
    const centroid = nodeVectors[0].map((_, colIndex) => nodeVectors.reduce((sum, vec) => sum + vec[colIndex], 0) / size);
    const normalizedCentroid = normalizeVector(centroid);
    // Base case: if size fits within MAX, return as leaf
    // Also stop if we are too deep to prevent infinite recursion
    if (size <= MAX_SIZE || depth > 5) {
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
    const K_child = Math.ceil(size / TARGET_SIZE);
    console.log(`[Clustering] Splitting node with ${size} items into ${K_child} children (Depth ${depth})`);
    // Run K-Means
    // @ts-ignore
    const { kmeans } = await Promise.resolve().then(() => __importStar(require('ml-kmeans')));
    // We use the subset of vectors for this cluster
    const result = kmeans(nodeVectors, K_child, { initialization: 'kmeans++' });
    // Group indices by new cluster assignment
    const childrenIndices = Array.from({ length: K_child }, () => []);
    result.clusters.forEach((clusterId, index) => {
        childrenIndices[clusterId].push(bookmarkIndices[index]);
    });
    // Recursively create children nodes
    const children = [];
    for (const indices of childrenIndices) {
        if (indices.length === 0)
            continue;
        const childNode = await recursiveCluster(indices, allVectors, depth + 1);
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
function mergeUndersizedClusters(root) {
    // Collect all leaf nodes
    const leaves = [];
    function traverse(node) {
        if (node.isLeaf) {
            leaves.push(node);
        }
        else {
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
            if (!activeLeaves.has(leaf))
                continue;
            if (leaf.items.length < MIN_SIZE) {
                // Find nearest neighbor
                let bestNeighbor = null;
                let maxSim = -1;
                for (const other of activeLeaves) {
                    if (leaf === other)
                        continue;
                    const sim = cosineSimilarity(leaf.centroid, other.centroid);
                    if (sim > maxSim) {
                        maxSim = sim;
                        bestNeighbor = other;
                    }
                }
                if (bestNeighbor && (leaf.items.length + bestNeighbor.items.length <= MAX_SIZE)) {
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
            l.isDeleted = true;
        }
    });
}
// Assign clusters to DB and generate names
async function assignClusters(node, userId, parentId, bookmarks, depth, job) {
    // Skip deleted nodes (from merging)
    if (node.isDeleted)
        return;
    // Generate name if not present (root might not need one, but top level clusters do)
    let clusterName = node.name;
    if (!clusterName && depth >= 0) {
        // Get representative bookmarks (closest to centroid would be best, but first 5 is okay for now)
        // To do closest to centroid properly, we'd need to compute distances. 
        // For efficiency, let's just take the first 5 items.
        const samples = node.items.slice(0, 5).map(idx => bookmarks[idx]).map((b) => `- ${b.title} (${b.url})`).join('\n');
        const depthContext = depth === 0 ? 'top-level category' : 'sub-category';
        const prompt = `
Analyze these bookmarks and provide a short, descriptive ${depthContext} name (e.g., "Web Development", "Italian Recipes").
Return ONLY the name, maximum 4 words. Do not use quotes or punctuation.
Do not include conversational text like "Sure" or "Here is the name".

Bookmarks:
${samples}
        `.trim();
        const name = await openai.generateChatCompletion(prompt);
        clusterName = name.replace(/"/g, '').trim();
    }
    // Save cluster to DB
    // Note: Root node (depth -1) usually isn't saved as a cluster, but its children are top-level.
    // However, our recursive function returns a tree where the top calls might be the top-level clusters.
    // Let's assume the caller handles the "Root" concept or we treat the first level as top-level.
    // In this implementation, we will treat the nodes passed here as actual clusters to be created.
    const centroidStr = pg_1.default.toSql(node.centroid.map((v) => Number(v)));
    await (0, client_1.query)(`INSERT INTO clusters (id, user_id, name, centroid, parent_id)
         VALUES ($1, $2, $3, $4, $5)`, [node.id, userId, clusterName || 'Uncategorized', centroidStr, parentId]);
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
            await (0, client_1.query)(`UPDATE bookmarks SET cluster_id = $1 WHERE id = $2`, [node.id, bookmark.id]);
        }
    }
    else {
        // Recurse for children
        for (const child of node.children) {
            await assignClusters(child, userId, node.id, bookmarks, depth + 1, job);
        }
    }
}
exports.clusteringWorker = new bullmq_1.Worker(queues_1.QUEUE_NAMES.CLUSTERING, async (job) => {
    const { userId, settings } = job.data;
    console.log(`[Clustering] Starting for user ${userId}`);
    // 1. Fetch all embeddings for user
    const res = await (0, client_1.query)(`SELECT b.id, b.title, b.url, e.vector 
       FROM bookmarks b
       JOIN embeddings e ON b.id = e.bookmark_id
       WHERE b.user_id = $1 AND b.status = 'EMBEDDED'`, [userId]);
    let bookmarks = res.rows;
    // Check total bookmarks to determine if we should wait for more embeddings
    const totalRes = await (0, client_1.query)(`SELECT COUNT(*) as count FROM bookmarks WHERE user_id = $1 AND status != 'BROKEN'`, [userId]);
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
        const errorRes = await (0, client_1.query)(`SELECT COUNT(*) as count FROM bookmarks WHERE user_id = $1 AND status = 'ERROR'`, [userId]);
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
    await (0, client_1.query)(`DELETE FROM clusters WHERE user_id = $1`, [userId]);
    // 3. Top level clustering
    const N = bookmarks.length;
    const K_top = Math.max(5, Math.min(50, Math.round(N / TARGET_SIZE)));
    console.log(`[Clustering] Top level: ${N} items into ${K_top} clusters`);
    // @ts-ignore
    const { kmeans } = await Promise.resolve().then(() => __importStar(require('ml-kmeans')));
    const result = kmeans(vectors, K_top, { initialization: 'kmeans++' });
    // Group into top level clusters
    const topLevelIndices = Array.from({ length: K_top }, () => []);
    result.clusters.forEach((clusterId, index) => {
        topLevelIndices[clusterId].push(index);
    });
    // 4. Recursive splitting
    const rootChildren = [];
    for (let k = 0; k < K_top; k++) {
        const indices = topLevelIndices[k];
        if (indices.length === 0)
            continue;
        const node = await recursiveCluster(indices, vectors, 0);
        rootChildren.push(node);
    }
    // Create a virtual root to hold everything
    const root = {
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
    mergeUndersizedClusters(root);
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
}, { connection: connection_1.connection, concurrency: 1 } // Sequential per user is safer for now
);
