import { enrichmentQueue, embeddingQueue, clusteringQueue } from '../src/queue/queues';
import { connection } from '../src/queue/connection';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('Checking Queue Status...');

    const queues = [
        { name: 'Enrichment', queue: enrichmentQueue },
        { name: 'Embedding', queue: embeddingQueue },
        { name: 'Clustering', queue: clusteringQueue }
    ];

    for (const q of queues) {
        const counts = await q.queue.getJobCounts();
        console.log(`${q.name} Queue:`, counts);
    }

    process.exit(0);
}

main().catch(console.error);
