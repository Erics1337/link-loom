"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renamingWorker = void 0;
const bullmq_1 = require("bullmq");
const connection_1 = require("../queue/connection");
const queues_1 = require("../queue/queues");
const openai_1 = require("../services/openai");
const client_1 = require("../db/client");
const openai = new openai_1.OpenAIService();
exports.renamingWorker = new bullmq_1.Worker(queues_1.QUEUE_NAMES.RENAMING, async (job) => {
    const { bookmarkId, content } = job.data;
    console.log(`[Renaming] Processing ${bookmarkId}`);
    try {
        // Generate a better title using OpenAI
        const newTitle = await openai.generateTitle(content);
        if (newTitle && newTitle.length > 0) {
            // First, check if we need to save the original title
            const currentRow = await (0, client_1.query)(`SELECT title, original_title FROM bookmarks WHERE id = $1`, [bookmarkId]);
            // If original_title is null, save the current title as original
            if (currentRow.rows.length > 0 && !currentRow.rows[0].original_title) {
                await (0, client_1.query)(`UPDATE bookmarks SET original_title = title WHERE id = $1`, [bookmarkId]);
            }
            // Update bookmark title with AI-generated one
            await (0, client_1.query)(`UPDATE bookmarks SET title = $1 WHERE id = $2`, [newTitle, bookmarkId]);
            console.log(`[Renaming] Updated title for ${bookmarkId}: "${newTitle}"`);
        }
        else {
            console.log(`[Renaming] No title generated for ${bookmarkId}, keeping original`);
        }
    }
    catch (error) {
        console.error(`[Renaming] Failed for ${bookmarkId}:`, error);
        // Don't throw - we don't want to fail the job if renaming fails
        // The original title will remain
    }
}, {
    connection: connection_1.connection,
    concurrency: 5,
    limiter: {
        max: 10, // Max 10 jobs
        duration: 1000 // Per second (Rate limit OpenAI)
    }
});
