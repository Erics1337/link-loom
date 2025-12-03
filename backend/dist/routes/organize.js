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
exports.organizeRoutes = organizeRoutes;
const queues_1 = require("../queue/queues");
async function organizeRoutes(fastify) {
    fastify.post('/organize', {
        schema: {
            body: {
                type: 'object',
                required: ['userId'],
                properties: {
                    userId: { type: 'string' },
                    settings: { type: 'object' }
                }
            }
        }
    }, async (request, reply) => {
        const { userId, settings } = request.body;
        const job = await queues_1.clusteringQueue.add('cluster', {
            userId,
            settings
        }, {
            attempts: 200, // Increased from 50 to handle large bookmark sets
            backoff: {
                type: 'exponential',
                delay: 2000 // Start at 2s, exponentially increase
            }
        });
        // Store job ID mapping for status check
        if (job.id) {
            const { redis } = await Promise.resolve().then(() => __importStar(require('../lib/redis')));
            await redis.set(`job:${userId}`, job.id);
        }
        request.log.info(`Received organize request for user ${userId}, Job ID: ${job.id}`);
        return { status: 'success', message: 'Organization job queued', jobId: job.id };
    });
}
