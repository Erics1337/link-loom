export class EmbeddingService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.endpoint = 'https://api.openai.com/v1/embeddings';
        this.model = 'text-embedding-3-small';
    }

    /**
     * Generates embeddings for a list of texts.
     * @param {string[]} texts - Array of strings to embed.
     * @param {AbortSignal} [signal] - Optional abort signal.
     * @returns {Promise<number[][]>} - Array of embedding vectors.
     */
    async fetchEmbeddings(texts, signal) {
        if (!this.apiKey) {
            throw new Error('OpenAI API Key is missing.');
        }

        if (texts.length === 0) return [];

        // OpenAI has a limit on the number of inputs per request (2048)
        // and a token limit. We'll batch by count for simplicity, assuming texts aren't huge.
        const BATCH_SIZE = 100;
        const allEmbeddings = [];

        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            if (signal?.aborted) throw new Error('Aborted');

            const batch = texts.slice(i, i + BATCH_SIZE);
            const embeddings = await this._fetchBatch(batch, signal);
            allEmbeddings.push(...embeddings);
        }

        return allEmbeddings;
    }

    async _fetchBatch(texts, signal) {
        // Clean texts: remove newlines, truncate if too long (8k tokens max, roughly 30k chars)
        const cleanedTexts = texts.map(t => t.replace(/\n/g, ' ').substring(0, 30000));

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                input: cleanedTexts,
                model: this.model
            }),
            signal
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(`Embedding API Error: ${response.status} - ${errorBody.error?.message || response.statusText}`);
        }

        const data = await response.json();
        // data.data is array of { object: 'embedding', index: 0, embedding: [...] }
        // Ensure they are sorted by index
        return data.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
    }
}
