"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const enrichmentWorker_1 = require("./workers/enrichmentWorker");
const embeddingWorker_1 = require("./workers/embeddingWorker");
const renamingWorker_1 = require("./workers/renamingWorker");
const clusteringWorker_1 = require("./workers/clusteringWorker");
console.log('Starting workers...');
enrichmentWorker_1.enrichmentWorker.on('ready', () => {
    console.log('Enrichment Worker ready!');
});
embeddingWorker_1.embeddingWorker.on('ready', () => {
    console.log('Embedding Worker ready!');
});
renamingWorker_1.renamingWorker.on('ready', () => {
    console.log('Renaming Worker ready!');
});
clusteringWorker_1.clusteringWorker.on('ready', () => {
    console.log('Clustering Worker ready!');
});
enrichmentWorker_1.enrichmentWorker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
});
