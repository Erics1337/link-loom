
async function testConcurrency() {
    const CONCURRENCY = 3;
    const chunks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const executing = [];
    const results = [];

    const processChunk = async (chunk, index) => {
        console.log(`Start ${chunk}`);
        await new Promise(r => setTimeout(r, 100 * Math.random()));
        if (chunk === 5) {
            console.log(`Chunk ${chunk} throwing error`);
            throw new Error("Fail");
        }
        console.log(`End ${chunk}`);
        return chunk;
    };

    try {
        for (let i = 0; i < chunks.length; i++) {
            // Simulate the logic in clustering.js
            // Note: In clustering.js, processChunk catches errors, so p resolves.
            // But let's test what happens if p rejects (simulating 'Aborted' or uncaught error)

            // Case A: processChunk catches error (Current behavior for non-abort)
            const p = processChunk(chunks[i], i).catch(e => {
                console.log(`Caught error for ${chunks[i]}: ${e.message}`);
            });

            // Case B: processChunk throws (Simulating 'Aborted')
            // const p = processChunk(chunks[i], i);

            results.push(p);

            if (CONCURRENCY <= chunks.length) {
                const e = p.then(() => {
                    console.log(`Splice ${chunks[i]}`);
                    executing.splice(executing.indexOf(e), 1);
                });
                executing.push(e);
                if (executing.length >= CONCURRENCY) {
                    console.log(`Waiting... Executing: ${executing.length}`);
                    await Promise.race(executing);
                    console.log(`Race finished. Executing: ${executing.length}`);
                }
            }
        }
        await Promise.all(results);
        console.log("Done");
    } catch (err) {
        console.error("Top level error:", err);
    }
}

testConcurrency();
