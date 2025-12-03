import { enrichmentWorker } from './workers/enrichmentWorker';
import { embeddingWorker } from './workers/embeddingWorker';
import { renamingWorker } from './workers/renamingWorker';
import { clusteringWorker } from './workers/clusteringWorker';

console.log('Starting workers...');

enrichmentWorker.on('ready', () => {
    console.log('Enrichment Worker ready!');
});

embeddingWorker.on('ready', () => {
    console.log('Embedding Worker ready!');
});

renamingWorker.on('ready', () => {
    console.log('Renaming Worker ready!');
});

clusteringWorker.on('ready', () => {
    console.log('Clustering Worker ready!');
});

enrichmentWorker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
});

