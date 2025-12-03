"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIService = void 0;
const openai_1 = __importDefault(require("openai"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class OpenAIService {
    constructor() {
        this.openai = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    async generateEmbedding(text) {
        // Truncate text to ~8k tokens roughly (30k chars is safe upper bound)
        const cleanText = text.replace(/\n/g, ' ').substring(0, 30000);
        const response = await this.openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: cleanText,
        });
        return response.data[0].embedding;
    }
    async generateChatCompletion(prompt, jsonMode = false) {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: prompt }
            ],
            response_format: jsonMode ? { type: 'json_object' } : undefined
        });
        return response.choices[0].message.content || '';
    }
    async generateTitle(content) {
        // Truncate content to avoid token limits
        const cleanContent = content.replace(/\n/g, ' ').substring(0, 5000);
        const prompt = `
Based on the following webpage content, generate a concise, descriptive title (max 60 characters).
The title should clearly describe what the page is about.
Return ONLY the title, nothing else.

Content:
${cleanContent}
        `.trim();
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a helpful assistant that generates concise, descriptive titles for webpages.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 50
        });
        const title = response.choices[0].message.content || '';
        return title.replace(/^["']|["']$/g, '').trim();
    }
}
exports.OpenAIService = OpenAIService;
