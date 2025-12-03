"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.embeddingWorker = void 0;
const bullmq_1 = require("bullmq");
const connection_1 = require("../queue/connection");
const queues_1 = require("../queue/queues");
const openai_1 = require("../services/openai");
const client_1 = require("../db/client");
const pg_1 = __importDefault(require("pgvector/pg"));
const openai = new openai_1.OpenAIService();
exports.embeddingWorker = new bullmq_1.Worker(queues_1.QUEUE_NAMES.EMBEDDING, async (job) => {
    const { bookmarkId, text } = job.data;
    console.log(`[Embedding] Processing ${bookmarkId}`);
    try {
        const vector = await openai.generateEmbedding(text);
        const vectorStr = pg_1.default.toSql(vector);
        // Save to embeddings table
        await (0, client_1.query)(`INSERT INTO embeddings (bookmark_id, vector)
         VALUES ($1, $2)
         ON CONFLICT (bookmark_id) DO UPDATE SET vector = EXCLUDED.vector`, [bookmarkId, vectorStr]);
        // Update bookmark status
        await (0, client_1.query)(`UPDATE bookmarks SET status = 'EMBEDDED' WHERE id = $1`, [bookmarkId]);
        console.log(`[Embedding] Saved vector for ${bookmarkId}`);
    }
    catch (error) {
        console.error(`[Embedding] Failed for ${bookmarkId}:`, error);
        await (0, client_1.query)(`UPDATE bookmarks SET status = 'ERROR' WHERE id = $1`, [bookmarkId]);
        throw error;
    }
}, {
    connection: connection_1.connection,
    concurrency: 5,
    limiter: {
        max: 10, // Max 10 jobs
        duration: 1000 // Per second (Rate limit OpenAI)
    }
});
