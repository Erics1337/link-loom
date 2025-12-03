import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export class OpenAIService {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async generateEmbedding(text: string): Promise<number[]> {
        // Truncate text to ~8k tokens roughly (30k chars is safe upper bound)
        const cleanText = text.replace(/\n/g, ' ').substring(0, 30000);

        let retries = 3;
        while (retries > 0) {
            try {
                const response = await this.openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: cleanText,
                });
                return response.data[0].embedding;
            } catch (error: any) {
                if (error.status === 429 && retries > 1) {
                    console.warn(`[OpenAI] Rate limit hit (Embedding). Retrying in 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    retries--;
                } else {
                    throw error;
                }
            }
        }
        throw new Error('OpenAI Rate Limit Exceeded after retries');
    }

    async generateChatCompletion(prompt: string, jsonMode = false): Promise<string> {
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

    async generateTitle(content: string): Promise<string> {
        // Truncate content to avoid token limits
        const cleanContent = content.replace(/\n/g, ' ').substring(0, 5000);

        const prompt = `
Based on the following webpage content, generate a concise, descriptive title (max 60 characters).
The title should clearly describe the specific page content.
Rules:
1. Remove site names, slogans, and boilerplate (e.g., " | Site Name", " - Home", "Just another WordPress site").
2. Make it readable and direct.
3. Return ONLY the title, nothing else.

Content:
${cleanContent}
        `.trim();

        let retries = 3;
        while (retries > 0) {
            try {
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
            } catch (error: any) {
                if (error.status === 429 && retries > 1) {
                    console.warn(`[OpenAI] Rate limit hit (Title). Retrying in 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    retries--;
                } else {
                    throw error;
                }
            }
        }
        throw new Error('OpenAI Rate Limit Exceeded after retries');
    }
}
