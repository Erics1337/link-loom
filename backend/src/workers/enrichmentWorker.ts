import { Worker, Job } from 'bullmq';
import { connection } from '../queue/connection';
import { QUEUE_NAMES, embeddingQueue, renamingQueue } from '../queue/queues';
import { FirecrawlService } from '../services/firecrawl';
import { query } from '../db/client';

const firecrawl = new FirecrawlService();

export const enrichmentWorker = new Worker(
    QUEUE_NAMES.ENRICHMENT,
    async (job: Job) => {
        const { bookmarkId, url, title, description } = job.data;
        console.log(`[Enrichment] Processing ${url}`);

        // 1. Check if metadata is sufficient
        const hasGoodMetadata = title && title.length > 10 && description && description.length > 30;

        let content = '';
        let status = 'ENRICHED';

        if (hasGoodMetadata) {
            console.log(`[Enrichment] Metadata sufficient for ${url}`);
            content = `Title: ${title}\nDescription: ${description}\nURL: ${url}`;
        } else {
            // Try lightweight head scrape first
            console.log(`[Enrichment] Metadata insufficient. Attempting head scrape for ${url}...`);
            const { scrapeHead } = await import('../services/headScraper');
            const headMeta = await scrapeHead(url);

            // 1. Check for Dead Links immediately
            if (headMeta.status === 'dead') {
                console.log(`[Enrichment] Link detected as DEAD (${headMeta.statusCode}) for ${url}`);
                await query(`UPDATE bookmarks SET status = 'BROKEN' WHERE id = $1`, [bookmarkId]);
                return; // Stop processing
            }

            const headTitle = headMeta.title || title;
            const headDesc = headMeta.description || description;

            // Check if head scrape gave us "good enough" metadata
            // We can be slightly more lenient here since it's better than nothing
            const isHeadGood = headTitle && headTitle.length > 5 && headDesc && headDesc.length > 20;

            if (isHeadGood) {
                console.log(`[Enrichment] Head scrape successful for ${url}`);

                let extraContent = '';
                if (headMeta.h1 && headMeta.h1 !== headTitle) extraContent += `\nHeading: ${headMeta.h1}`;
                if (headMeta.keywords && headMeta.keywords.length > 0) extraContent += `\nKeywords: ${headMeta.keywords.join(', ')}`;

                // Extract useful JSON-LD if available
                if (headMeta.jsonLd) {
                    const json = headMeta.jsonLd;
                    if (json.headline) extraContent += `\nHeadline: ${json.headline}`;
                    if (json.articleBody) extraContent += `\nSnippet: ${json.articleBody.substring(0, 200)}...`;
                    if (json.author && json.author.name) extraContent += `\nAuthor: ${json.author.name}`;
                }

                content = `Title: ${headTitle}\nDescription: ${headDesc}\nURL: ${url}${extraContent}`;

                // Update title in DB if we found a better one
                if (headMeta.title && headMeta.title !== title) {
                    await query(`UPDATE bookmarks SET title = $1 WHERE id = $2`, [headMeta.title, bookmarkId]);
                }
            } else {
                console.log(`[Enrichment] Head scrape insufficient. Falling back to Firecrawl for ${url}...`);
                try {
                    const result = await firecrawl.scrapeUrl(url);
                    content = result.content;

                    if (result.status === 'dead') {
                        status = 'BROKEN'; // Handle dead links specifically
                    }
                } catch (error: any) {
                    // Handle Quota Exceeded / Payment Required by falling back
                    if (error.message.includes('Quota Exceeded') || error.message.includes('Payment Required')) {
                        console.warn(`[Enrichment] Firecrawl Quota Exceeded for ${url}. Falling back to basic metadata.`);
                        // Fallback to whatever we have
                        content = `Title: ${title || 'Unknown'}\nURL: ${url}`;
                        // Mark as ENRICHED so it gets embedded
                        status = 'ENRICHED';
                    } else {
                        console.warn(`[Enrichment] Scraping failed for ${url}, falling back to basic metadata:`, error.message);
                        // Fallback to whatever we have
                        content = `Title: ${title || 'Unknown'}\nURL: ${url}`;
                        // Still mark as ENRICHED so it gets embedded (even if just URL/Title)
                        status = 'ENRICHED';
                    }
                }
            }
        }

        // 2. Update DB
        const updateResult = await query(
            `UPDATE bookmarks SET content = $1, status = $2 WHERE id = $3`,
            [content, status, bookmarkId]
        );

        if (updateResult.rowCount === 0) {
            console.warn(`[Enrichment] Bookmark ${bookmarkId} not found (deleted?). Skipping embedding.`);
            return;
        }

        // 4. Push to Renaming Queue (runs in parallel with embedding)
        // CHANGED: Now sequential. Enrichment -> Renaming -> Embedding.
        // We push to Renaming, and Renaming will push to Embedding.
        if (status === 'ENRICHED') {
            await renamingQueue.add('rename', {
                bookmarkId,
                content
            }, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000
                }
            });
        }
    },
    { connection, concurrency: 3 }
);
