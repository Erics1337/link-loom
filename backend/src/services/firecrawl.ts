import dotenv from 'dotenv';

dotenv.config();

export interface ScrapeResult {
    content: string;
    status: 'success' | 'dead' | 'fallback';
    title?: string;
    error?: string;
}

export class FirecrawlService {
    private apiKey: string;
    private baseUrl = 'https://api.firecrawl.dev/v0';

    constructor() {
        this.apiKey = process.env.FIRECRAWL_API_KEY || '';
    }

    async scrapeUrl(url: string): Promise<ScrapeResult> {
        if (!this.apiKey) {
            console.warn('Firecrawl API Key missing. Using fallback.');
            return this.getFallback(url, 'Missing API Key');
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

            const response = await fetch(`${this.baseUrl}/scrape`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({ url }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 404 || response.status === 500) {
                    return { content: '', status: 'dead', error: `HTTP ${response.status}` };
                }
                if (response.status === 402 || response.status === 429) {
                    console.warn('Firecrawl Quota Exceeded.');
                    throw new Error('Firecrawl Quota Exceeded');
                }
                throw new Error(`Firecrawl API Error: ${response.statusText}`);
            }

            const data = await response.json() as any;
            return {
                content: data.markdown || '',
                status: 'success',
                title: data.metadata?.title
            };

        } catch (error: any) {
            if (error.message.includes('Quota Exceeded') || error.message.includes('Payment Required')) {
                throw error;
            }
            console.error(`Scrape failed for ${url}:`, error.message);
            return this.getFallback(url, error.message);
        }
    }

    private getFallback(url: string, reason: string): ScrapeResult {
        try {
            const urlObj = new URL(url);
            return {
                content: `# ${urlObj.hostname}\nURL: ${url}\nNote: Scrape failed (${reason}).`,
                status: 'fallback'
            };
        } catch {
            return { content: '', status: 'dead', error: 'Invalid URL' };
        }
    }
}
