"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichmentWorker = void 0;
const bullmq_1 = require("bullmq");
const connection_1 = require("../queue/connection");
const queues_1 = require("../queue/queues");
const firecrawl_1 = require("../services/firecrawl");
const client_1 = require("../db/client");
const firecrawl = new firecrawl_1.FirecrawlService();
exports.enrichmentWorker = new bullmq_1.Worker(queues_1.QUEUE_NAMES.ENRICHMENT, async (job) => {
    const { bookmarkId, url, title, description } = job.data;
    console.log(`[Enrichment] Processing ${url}`);
    // 1. Check if metadata is sufficient
    const hasGoodMetadata = title && title.length > 10 && description && description.length > 30;
    let content = '';
    let status = 'ENRICHED';
    if (hasGoodMetadata) {
        console.log(`[Enrichment] Metadata sufficient for ${url}`);
        content = `Title: ${title}\nDescription: ${description}\nURL: ${url}`;
    }
    else {
        console.log(`[Enrichment] Scraping ${url}...`);
        try {
            const result = await firecrawl.scrapeUrl(url);
            content = result.content;
            if (result.status === 'dead') {
                status = 'BROKEN'; // Handle dead links specifically
            }
        }
        catch (error) {
            // Critical errors that should stop the job/queue
            if (error.message.includes('Quota Exceeded') || error.message.includes('Payment Required')) {
                console.error(`[Enrichment] Critical Firecrawl error for ${url}: ${error.message}. Stopping job.`);
                throw error; // Rethrow to fail the job
            }
            console.warn(`[Enrichment] Scraping failed for ${url}, falling back to basic metadata:`, error.message);
            // Fallback to whatever we have
            content = `Title: ${title || 'Unknown'}\nURL: ${url}`;
            // Still mark as ENRICHED so it gets embedded (even if just URL/Title)
            status = 'ENRICHED';
        }
    }
    // 2. Update DB
    await (0, client_1.query)(`UPDATE bookmarks SET content = $1, status = $2 WHERE id = $3`, [content, status, bookmarkId]);
    // 3. Push to Embedding Queue if successful
    if (status === 'ENRICHED') {
        await queues_1.embeddingQueue.add('embed', {
            bookmarkId,
            text: content
        });
        // 4. Push to Renaming Queue (runs in parallel with embedding)
        await queues_1.renamingQueue.add('rename', {
            bookmarkId,
            content
        });
    }
}, { connection: connection_1.connection, concurrency: 5 });
