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
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusRoutes = statusRoutes;
async function statusRoutes(fastify) {
    fastify.get('/status', {
        schema: {
            querystring: {
                type: 'object',
                required: ['userId'],
                properties: {
                    userId: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { userId } = request.query;
        const { redis } = await Promise.resolve().then(() => __importStar(require('../lib/redis')));
        const jobId = await redis.get(`job:${userId}`);
        if (!jobId) {
            return { status: 'idle', progress: 0, message: 'Ready to organize' };
        }
        const { clusteringQueue } = await Promise.resolve().then(() => __importStar(require('../queue/queues')));
        const job = await clusteringQueue.getJob(jobId);
        if (!job) {
            return { status: 'idle', progress: 0, message: 'Job not found' };
        }
        const state = await job.getState(); // completed, failed, delayed, active, waiting
        console.log(`[Status] Job ${jobId} state: ${state}`);
        const progressData = job.progress; // Progress can be number or object
        // Map BullMQ state to our API status
        let status = 'processing';
        if (state === 'completed')
            status = 'completed';
        if (state === 'failed')
            status = 'failed';
        if (state === 'waiting' || state === 'delayed')
            status = 'waiting';
        // Build detailed message based on progress data
        let message = `Processing... ${state}`;
        let progressPercent = 0;
        if (progressData && typeof progressData === 'object') {
            if (progressData.phase === 'waiting_for_embeddings') {
                const { embedded, total } = progressData;
                message = `Embedding: ${embedded}/${total}`;
                // Embedding takes ~70% of total time (was 90%)
                progressPercent = total > 0 ? Math.round((embedded / total) * 70) : 0; // 0-70%
            }
            else if (progressData.phase === 'clustering') {
                // Use the detailed message from the worker
                message = progressData.message || 'Clustering bookmarks...';
                // Clustering takes 70-95% (25% of total time for AI naming)
                // Use progress if provided, otherwise default to 70
                progressPercent = progressData.progress || 70;
            }
            else if (progressData.phase === 'complete') {
                message = progressData.message || 'Finalizing...';
                progressPercent = 100;
            }
        }
        else if (typeof progressData === 'number') {
            progressPercent = progressData;
        }
        if (status === 'completed') {
            message = 'Organization complete';
            progressPercent = 100;
        }
        return {
            status,
            progress: progressPercent,
            message,
            details: progressData // Include raw progress data for debugging
        };
    });
    fastify.get('/structure', {
        schema: {
            querystring: {
                type: 'object',
                required: ['userId'],
                properties: {
                    userId: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { userId } = request.query;
        // Fetch all clusters
        const res = await Promise.resolve().then(() => __importStar(require('../db/client'))).then(m => m.query(`SELECT id, name, parent_id, centroid FROM clusters WHERE user_id = $1`, [userId]));
        // Build hierarchical structure
        const clustersById = new Map();
        const rootClusters = [];
        // First pass: create cluster objects
        for (const c of res.rows) {
            const bRes = await Promise.resolve().then(() => __importStar(require('../db/client'))).then(m => m.query(`SELECT id, title, original_title, url, status FROM bookmarks WHERE cluster_id = $1`, [c.id]));
            const clusterNode = {
                title: c.name,
                children: bRes.rows.map((r) => ({
                    // Strip userId_ prefix to get original Chrome ID
                    id: r.id.includes('_') ? r.id.substring(37) : r.id,
                    title: r.original_title || r.title,
                    suggestedTitle: r.original_title ? r.title : undefined,
                    url: r.url,
                    scrapeStatus: r.status === 'BROKEN' ? 'dead' : undefined
                })),
                subcategories: [] // Will hold sub-clusters
            };
            clustersById.set(c.id, { ...clusterNode, parentId: c.parent_id });
            if (!c.parent_id) {
                rootClusters.push(clusterNode);
            }
        }
        // Second pass: build hierarchy
        for (const [clusterId, cluster] of clustersById.entries()) {
            if (cluster.parentId) {
                const parent = clustersById.get(cluster.parentId);
                if (parent) {
                    parent.subcategories.push({
                        title: cluster.title,
                        children: cluster.children,
                        subcategories: cluster.subcategories
                    });
                }
            }
        }
        // Merge subcategories into children array for each cluster
        function flattenStructure(node) {
            const result = {
                title: node.title,
                children: [...node.children]
            };
            if (node.subcategories && node.subcategories.length > 0) {
                // Add subcategories as folder children
                for (const sub of node.subcategories) {
                    result.children.push(flattenStructure(sub));
                }
            }
            return result;
        }
        const structure = rootClusters.map(flattenStructure);
        // Mark duplicates in the structure
        const seenUrls = new Set();
        function markDuplicates(nodes) {
            for (const node of nodes) {
                if (node.children) {
                    // It's a folder, recurse into children
                    markDuplicates(node.children);
                }
                else if (node.url) {
                    // It's a bookmark
                    if (seenUrls.has(node.url)) {
                        node.isDuplicate = true;
                    }
                    else {
                        seenUrls.add(node.url);
                    }
                }
            }
        }
        markDuplicates(structure);
        // Fetch Metadata
        const { redis } = await Promise.resolve().then(() => __importStar(require('../lib/redis')));
        const metaStr = await redis.get(`metadata:${userId}`);
        const meta = metaStr ? JSON.parse(metaStr) : { duplicateCount: 0 };
        const brokenRes = await Promise.resolve().then(() => __importStar(require('../db/client'))).then(m => m.query(`SELECT COUNT(*) as count FROM bookmarks WHERE user_id = $1 AND status = 'BROKEN'`, [userId]));
        const brokenCount = parseInt(brokenRes.rows[0].count);
        return {
            structure,
            metadata: {
                duplicateCount: meta.duplicateCount,
                brokenCount: brokenCount
            }
        };
    });
}
