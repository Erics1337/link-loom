
import * as cheerio from 'cheerio';

export interface ScrapedMetadata {
    title?: string;
    description?: string;
    image?: string;
    keywords?: string[];
    h1?: string;
    jsonLd?: any;
    url?: string;
    status: 'ok' | 'dead' | 'error';
    statusCode?: number;
}

export async function scrapeHead(url: string): Promise<ScrapedMetadata> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LinkLoom/1.0; +http://linkloom.app)'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            // 404, 410, 403, 500 etc.
            // We consider 4xx as dead links usually, especially 404/410
            if (response.status === 404 || response.status === 410 || response.status === 403) {
                return { url, status: 'dead', statusCode: response.status };
            }
            return { url, status: 'error', statusCode: response.status };
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const metadata: ScrapedMetadata = {
            url: url,
            status: 'ok',
            statusCode: response.status
        };

        // Title Strategy: OG > Twitter > Title Tag
        metadata.title =
            $('meta[property="og:title"]').attr('content') ||
            $('meta[name="twitter:title"]').attr('content') ||
            $('title').text() ||
            undefined;

        // Description Strategy: OG > Twitter > Meta Description
        metadata.description =
            $('meta[property="og:description"]').attr('content') ||
            $('meta[name="twitter:description"]').attr('content') ||
            $('meta[name="description"]').attr('content') ||
            undefined;

        // Image Strategy: OG > Twitter
        metadata.image =
            $('meta[property="og:image"]').attr('content') ||
            $('meta[name="twitter:image"]').attr('content') ||
            undefined;

        // Keywords
        const keywordsStr = $('meta[name="keywords"]').attr('content');
        if (keywordsStr) {
            metadata.keywords = keywordsStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
        }

        // H1
        const h1 = $('h1').first().text().trim();
        if (h1) {
            metadata.h1 = h1;
        }

        // JSON-LD
        try {
            const jsonLdScript = $('script[type="application/ld+json"]').first().html();
            if (jsonLdScript) {
                const json = JSON.parse(jsonLdScript);
                metadata.jsonLd = json;
            }
        } catch (e) {
            // Ignore JSON parse errors
        }

        // Clean up
        if (metadata.title) metadata.title = metadata.title.trim();
        if (metadata.description) metadata.description = metadata.description.trim();

        return metadata;

    } catch (error: any) {
        // Network errors, DNS errors, Timeouts
        if (error.name === 'AbortError') {
            // Timeout - could be dead or just slow. We'll mark as error for now, 
            // but if it's consistently slow it might be dead.
            return { url, status: 'error', statusCode: 408 };
        }

        if (error.cause && error.cause.code === 'ENOTFOUND') {
            // DNS resolution failed -> Definitely dead
            return { url, status: 'dead', statusCode: 0 };
        }

        if (error.cause && error.cause.code === 'ECONNREFUSED') {
            // Connection refused -> Likely dead
            return { url, status: 'dead', statusCode: 0 };
        }

        // Other errors
        return { url, status: 'error', statusCode: 500 };
    }
}
