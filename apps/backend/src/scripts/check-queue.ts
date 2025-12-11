
import { queues } from '../lib/queue';

async function check() {
    console.log('Checking queues...');
    const counts = await queues.clustering.getJobCounts();
    console.log('Clustering Queue Counts:', counts);
    
    const active = await queues.clustering.getActive();
    console.log('Active Jobs:', active.map(j => ({ id: j.id, data: j.data })));
    
    const failed = await queues.clustering.getFailed();
    console.log('Failed Jobs:', failed.map(j => ({ id: j.id, reason: j.failedReason })));

    process.exit(0);
}

check();
