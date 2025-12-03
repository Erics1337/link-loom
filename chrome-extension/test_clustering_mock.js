
// Mock Clustering Service Test
class MockClusteringService {
    constructor() {
        this.CONCURRENCY = 3;
    }

    async organize(bookmarks) {
        console.log(`Starting organization for ${bookmarks.length} bookmarks`);
        const chunks = [];
        const CHUNK_SIZE = 2; // Small chunk size for testing
        for (let i = 0; i < bookmarks.length; i += CHUNK_SIZE) {
            chunks.push(bookmarks.slice(i, i + CHUNK_SIZE));
        }

        const executing = [];
        const results = [];

        const processChunk = async (chunk, index) => {
            console.log(`Start Batch ${index}`);
            // Simulate LLM call with random delay
            await new Promise(r => setTimeout(r, Math.random() * 500));
            console.log(`End Batch ${index}`);
            return index;
        };

        for (let i = 0; i < chunks.length; i++) {
            const p = processChunk(chunks[i], i);
            results.push(p);

            if (this.CONCURRENCY <= chunks.length) {
                const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                executing.push(e);
                if (executing.length >= this.CONCURRENCY) {
                    console.log(`Waiting... Executing: ${executing.length}`);
                    await Promise.race(executing);
                }
            }
        }
        await Promise.all(results);
        console.log("Organization complete");
    }
}

async function runTest() {
    const service = new MockClusteringService();
    // Create 20 dummy bookmarks
    const bookmarks = Array.from({ length: 20 }, (_, i) => ({ id: i, title: `Bookmark ${i}` }));
    await service.organize(bookmarks);
}

runTest();
