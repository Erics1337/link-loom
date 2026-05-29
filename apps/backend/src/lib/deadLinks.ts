import { safeFetch } from './safeFetch';

const DEAD_LINK_TIMEOUT_MS = 3000;
const DEAD_LINK_STATUSES = new Set([404, 410, 451]);
const DEAD_LINK_NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

const fetchWithTimeout = async (url: string, method: 'HEAD' | 'GET') => {
    const headers = method === 'GET' ? { Range: 'bytes=0-0' } : undefined;
    return safeFetch(url, { method, headers, timeoutMs: DEAD_LINK_TIMEOUT_MS });
};

export const isDeadBookmarkUrl = async (rawUrl: string) => {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return true;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        return false;
    }

    try {
        const response = await fetchWithTimeout(url.toString(), 'HEAD');
        // Any response (even 405 "method not allowed") means the server is alive.
        // Only certain statuses indicate the page is gone.
        return DEAD_LINK_STATUSES.has(response.status);
    } catch (error: any) {
        const code = error?.cause?.code ?? error?.code;
        if (code && DEAD_LINK_NETWORK_CODES.has(String(code))) {
            return true;
        }
        return false;
    }
};
