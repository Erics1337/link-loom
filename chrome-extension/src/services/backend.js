export class BackendService {
    constructor(baseUrl = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
    }

    async _fetchWithTimeout(url, options = {}) {
        const { timeout = 30000 } = options;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    }

    async syncBookmarks(userId, bookmarks) {
        const response = await this._fetchWithTimeout(`${this.baseUrl}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, bookmarks })
        });
        if (!response.ok) {
            let errorMessage = response.statusText;
            try {
                const errorBody = await response.json();
                if (errorBody.message) errorMessage = errorBody.message;
            } catch (e) {
                // Ignore json parse error
            }
            throw new Error(`Sync failed: ${errorMessage}`);
        }
        return await response.json();
    }

    async organize(userId, settings) {
        const response = await this._fetchWithTimeout(`${this.baseUrl}/organize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, settings })
        });
        if (!response.ok) throw new Error(`Organize failed: ${response.statusText}`);
        return await response.json();
    }

    async getStatus(userId) {
        const response = await this._fetchWithTimeout(`${this.baseUrl}/status?userId=${userId}`);
        if (!response.ok) throw new Error(`Get status failed: ${response.statusText}`);
        return await response.json();
    }

    async getStructure(userId) {
        const response = await this._fetchWithTimeout(`${this.baseUrl}/structure?userId=${userId}`);
        if (!response.ok) throw new Error(`Get structure failed: ${response.statusText}`);
        return await response.json();
    }
}
