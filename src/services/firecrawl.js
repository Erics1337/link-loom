// LinkLoom - Firecrawl Service
// Handles deep scraping of bookmark URLs to extract markdown content

export class FirecrawlService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.firecrawl.dev/v0';
    }

    /**
     * Scrapes a single URL and returns result object
     * @param {string} url 
     * @returns {Promise<{content: string, status: 'success'|'dead'|'fallback'}>}
     */
    async scrapeUrl(url) {
        if (!this.apiKey) {
            console.warn('Firecrawl API key missing. Returning mock data.');
            return { content: this._getMockMarkdown(url), status: 'success' };
        }

        try {
            const controller = new AbortController();
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

                // For 403/401 (Auth Required) or 429 (Rate Limit), we assume it's protected/busy but alive -> Fallback
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
            return { content: data.markdown || '', status: 'success', title: scrapedTitle };

        } catch (error) {
            console.warn('Failed to scrape URL, checking if dead or fallback needed:', url, error.message);

            // Handle Timeout specifically
            if (error.name === 'AbortError') {
                console.warn(`Timeout scraping ${url}. Using fallback.`);
                // Fallback logic below will handle generating metadata
            }

            // Heuristic: If it's a network error or specific API error, might be dead
            // But Firecrawl API wrappers might mask DNS errors as 500s or generic errors.
            // For now, we treat explicit 404s (handled above) as dead.
            // If fetch failed completely (network error), it might be dead.

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
     * @returns {Promise<Array>} Bookmarks with added 'content' property
     */
    async batchScrape(bookmarks, onProgress) {
        // Process in chunks to avoid rate limits
        const results = [];
        const CHUNK_SIZE = 5;
        let processedCount = 0;

        for (let i = 0; i < bookmarks.length; i += CHUNK_SIZE) {
            const chunk = bookmarks.slice(i, i + CHUNK_SIZE);
            const promises = chunk.map(async (bm) => {
                const result = await this.scrapeUrl(bm.url);
                processedCount++;
                if (onProgress) onProgress(processedCount, bookmarks.length, bm.url);
                return { ...bm, content: result.content, scrapeStatus: result.status, scrapedTitle: result.title };
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
