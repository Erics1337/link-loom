"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookmarkService = void 0;
const client_1 = require("../db/client");
const queues_1 = require("../queue/queues");
class BookmarkService {
    async syncBookmarks(userId, bookmarks) {
        // 1. Ensure user exists
        await (0, client_1.query)(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
        // 2. Upsert bookmarks
        let newCount = 0;
        let updatedCount = 0;
        for (const bm of bookmarks) {
            // Use composite ID to prevent collisions between users
            // Format: userId_chromeId
            const dbId = `${userId}_${bm.id}`;
            const res = await (0, client_1.query)(`INSERT INTO bookmarks (id, user_id, url, title, status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         ON CONFLICT (id) 
         DO UPDATE SET 
           url = EXCLUDED.url,
           title = EXCLUDED.title,
           updated_at = CURRENT_TIMESTAMP
         RETURNING xmax`, [dbId, userId, bm.url, bm.title]);
            if (res.rows[0]?.xmax === '0') {
                newCount++;
                // Trigger enrichment for new bookmarks
                await queues_1.enrichmentQueue.add('enrich', {
                    bookmarkId: dbId,
                    url: bm.url,
                    title: bm.title
                });
            }
            else {
                updatedCount++;
                // Check if it was in ERROR state, if so, retry
                const currentStatusRes = await (0, client_1.query)(`SELECT status FROM bookmarks WHERE id = $1`, [dbId]);
                if (currentStatusRes.rows[0]?.status === 'ERROR') {
                    console.log(`Retrying failed bookmark: ${dbId}`);
                    await (0, client_1.query)(`UPDATE bookmarks SET status = 'PENDING' WHERE id = $1`, [dbId]);
                    await queues_1.enrichmentQueue.add('enrich', {
                        bookmarkId: dbId,
                        url: bm.url,
                        title: bm.title
                    });
                }
            }
        }
        // 3. Calculate Duplicates (based on input array)
        const uniqueUrls = new Set(bookmarks.map(b => b.url));
        const duplicateCount = bookmarks.length - uniqueUrls.size;
        // Store metadata in Redis
        const { redis } = await Promise.resolve().then(() => __importStar(require('../lib/redis')));
        await redis.set(`metadata:${userId}`, JSON.stringify({ duplicateCount }));
        return { newCount, updatedCount, total: bookmarks.length, duplicateCount };
    }
}
exports.BookmarkService = BookmarkService;
