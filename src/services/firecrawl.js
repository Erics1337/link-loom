// LinkLoom - Firecrawl Service
// Handles deep scraping of bookmark URLs to extract markdown content

export class FirecrawlService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.firecrawl.dev/v0';
        this.cache = new Map(); // In-memory cache for scrape results
        this.fallbackMode = false;
    }

    setFallbackMode(enabled) {
        this.fallbackMode = enabled;
    }

    /**
     * Scrapes a single URL and returns result object
     * @param {string} url 
     * @param {AbortSignal} [signal]
     * @returns {Promise<{content: string, status: 'success'|'dead'|'fallback'}>}
     */
    async scrapeUrl(url, signal) {
        // Check cache first
        if (this.cache.has(url)) {
            console.log(`Cache hit for: ${url}`);
            return this.cache.get(url);
        }

        if (signal?.aborted) throw new Error('Aborted');

        if (!this.apiKey || this.fallbackMode) {
            if (this.fallbackMode) console.log('Fallback mode active. Skipping API call.');
            else console.warn('Firecrawl API key missing. Returning mock data.');

            // Generate fallback content locally
            const urlObj = new URL(url);
            const fallbackContent = `
# ${urlObj.hostname}
URL: ${url}
Domain: ${urlObj.hostname}
Path: ${urlObj.pathname}
Note: Metadata Mode (Fallback). Categorize based on domain and URL structure.
`;
            return { content: fallbackContent, status: 'fallback' };
        }

        try {
            const controller = new AbortController();

            // Link parent signal
            if (signal) {
                signal.addEventListener('abort', () => controller.abort());
            }

            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

            const response = await fetch(`${this.baseUrl}/scrape`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({ url: url }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                // Check for specific error codes that indicate a dead link
                // 404: Not Found
                // 500: Server Error (often DNS/Connection failed on Firecrawl side)
                // 400: Bad Request (often Invalid URL or DNS failure)
                if (response.status === 404 || response.status === 500 || response.status === 400) {
                    return { content: '', status: 'dead', error: `HTTP ${response.status}` };
                }

                // For 402 (Payment/Quota), 403/401 (Auth), or 429 (Rate Limit) -> Fallback
                if (response.status === 402 || response.status === 429) {
                    console.warn(`Firecrawl Quota/Rate Limit Exceeded (${response.status}). Using fallback.`);
                    // Generate fallback content
                    const urlObj = new URL(url);
                    const fallbackContent = `
# ${urlObj.hostname}
URL: ${url}
Domain: ${urlObj.hostname}
Path: ${urlObj.pathname}
Note: Firecrawl Quota Exceeded. Categorize based on domain and URL structure.
`;
                    return { content: fallbackContent, status: 'fallback', quotaExceeded: true };
                }

                let errorMessage = response.statusText;
                try {
                    const errorBody = await response.json();
                    errorMessage = errorBody.error || errorBody.message || JSON.stringify(errorBody);
                } catch (e) { }

                console.warn(`Firecrawl Error (${response.status}): ${errorMessage}. Using fallback.`);
                throw new Error(`Firecrawl API Error (${response.status})`);
            }

            const data = await response.json();
            const scrapedTitle = data.metadata ? data.metadata.title : null;
            const result = { content: data.markdown || '', status: 'success', title: scrapedTitle };

            this.cache.set(url, result); // Cache the result
            return result;

        } catch (error) {
            if (error.name === 'AbortError') {
                if (signal?.aborted) throw new Error('Aborted');
                console.warn(`Timeout scraping ${url}. Using fallback.`);
                // Fallback logic below
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                // Network errors (DNS, Connection Refused) usually mean dead link
                return { content: '', status: 'dead', error: 'Network Error (DNS/Connection)' };
            }

            if (error.message === 'Aborted') throw error;

            console.warn('Failed to scrape URL, checking if dead or fallback needed:', url, error.message);

            // Fallback: Generate markdown from URL metadata so the LLM can still categorize it
            try {
                const urlObj = new URL(url);
                const fallbackContent = `
# ${urlObj.hostname}
URL: ${url}
Domain: ${urlObj.hostname}
Path: ${urlObj.pathname}
Note: Content scraping failed or not supported (Timeout/Error). Categorize based on domain and URL structure.
`;
                return { content: fallbackContent, status: 'fallback' };
            } catch (e) {
                return { content: '', status: 'dead', error: 'Invalid URL' };
            }
        }
    }

    /**
     * Batch processes a list of bookmarks
     * @param {Array} bookmarks 
     * @param {Function} onProgress - Callback (current, total, url)
     * @param {AbortSignal} [signal]
     * @returns {Promise<Array>} Bookmarks with added 'content' property
     */
    async batchScrape(bookmarks, onProgress, signal) {
        // Process in chunks to avoid rate limits
        const results = [];
        const CHUNK_SIZE = 5;
        let processedCount = 0;

        for (let i = 0; i < bookmarks.length; i += CHUNK_SIZE) {
            if (signal?.aborted) throw new Error('Aborted');

            const chunk = bookmarks.slice(i, i + CHUNK_SIZE);
            const promises = chunk.map(async (bm) => {
                if (signal?.aborted) return { ...bm, scrapeStatus: 'aborted' }; // Skip

                const result = await this.scrapeUrl(bm.url, signal);
                processedCount++;
                if (onProgress) onProgress(processedCount, bookmarks.length, bm.url, result);
                return { ...bm, content: result.content, scrapeStatus: result.status, scrapedTitle: result.title, quotaExceeded: result.quotaExceeded };
            });

            const chunkResults = await Promise.all(promises);
            results.push(...chunkResults);
        }

        return results;
    }

    _getMockMarkdown(url) {
        return `
# Mock Content for ${url}
This is a simulated scrape result. 
In a real scenario, this would contain the full text of the webpage, 
allowing the LLM to understand that this page is about specific topics.
    `;
    }
}
