import { enrichmentQueue } from '../src/queue/queues';
import { connection } from '../src/queue/connection';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('Inspecting failed enrichment jobs...');

    const failedJobs = await enrichmentQueue.getFailed(0, 5);

    if (failedJobs.length === 0) {
        console.log('No failed jobs found.');
    } else {
        console.log(`Found ${failedJobs.length} failed jobs. Showing first 5:`);
        for (const job of failedJobs) {
            console.log(`Job ${job.id} failed with reason: ${job.failedReason}`);
            console.log(`Stacktrace: ${job.stacktrace[0]}`);
            console.log('---');
        }
    }

    process.exit(0);
}

main().catch(console.error);
