"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirecrawlService = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class FirecrawlService {
    constructor() {
        this.baseUrl = 'https://api.firecrawl.dev/v0';
        this.apiKey = process.env.FIRECRAWL_API_KEY || '';
    }
    async scrapeUrl(url) {
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
            const data = await response.json();
            return {
                content: data.markdown || '',
                status: 'success',
                title: data.metadata?.title
            };
        }
        catch (error) {
            console.log(`[Firecrawl Debug] Caught error: "${error.message}"`);
            if (error.message.includes('Quota Exceeded') || error.message.includes('Payment Required')) {
                throw error;
            }
            console.error(`Scrape failed for ${url}:`, error.message);
            return this.getFallback(url, error.message);
        }
    }
    getFallback(url, reason) {
        try {
            const urlObj = new URL(url);
            return {
                content: `# ${urlObj.hostname}\nURL: ${url}\nNote: Scrape failed (${reason}).`,
                status: 'fallback'
            };
        }
        catch {
            return { content: '', status: 'dead', error: 'Invalid URL' };
        }
    }
}
exports.FirecrawlService = FirecrawlService;
