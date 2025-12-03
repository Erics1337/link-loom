"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clusteringQueue = exports.renamingQueue = exports.embeddingQueue = exports.enrichmentQueue = exports.QUEUE_NAMES = void 0;
const bullmq_1 = require("bullmq");
const connection_1 = require("./connection");
exports.QUEUE_NAMES = {
    ENRICHMENT: 'enrichment-queue',
    EMBEDDING: 'embedding-queue',
    RENAMING: 'renaming-queue',
    CLUSTERING: 'clustering-queue',
};
exports.enrichmentQueue = new bullmq_1.Queue(exports.QUEUE_NAMES.ENRICHMENT, { connection: connection_1.connection });
exports.embeddingQueue = new bullmq_1.Queue(exports.QUEUE_NAMES.EMBEDDING, { connection: connection_1.connection });
exports.renamingQueue = new bullmq_1.Queue(exports.QUEUE_NAMES.RENAMING, { connection: connection_1.connection });
exports.clusteringQueue = new bullmq_1.Queue(exports.QUEUE_NAMES.CLUSTERING, { connection: connection_1.connection });
