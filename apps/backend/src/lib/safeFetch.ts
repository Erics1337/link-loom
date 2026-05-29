import { lookup } from 'dns/promises';
import net from 'net';

type SafeFetchOptions = {
    method?: 'HEAD' | 'GET';
    headers?: HeadersInit;
    timeoutMs?: number;
    maxRedirects?: number;
};

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

const isPrivateIpv4 = (address: string) => {
    const parts = address.split('.').map(part => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) return true;
    const [a, b] = parts;
    return (
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 0
    );
};

const isPrivateIpv6 = (address: string) => {
    const normalized = address.toLowerCase();
    return (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:')
    );
};

const isBlockedIp = (address: string) => {
    const family = net.isIP(address);
    if (family === 4) return isPrivateIpv4(address);
    if (family === 6) return isPrivateIpv6(address);
    return true;
};

const validatePublicHttpUrl = async (rawUrl: string) => {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http and https URLs can be fetched.');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
        throw new Error('Localhost URLs are not allowed.');
    }

    if (net.isIP(hostname) && isBlockedIp(hostname)) {
        throw new Error('Private network URLs are not allowed.');
    }

    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(item => isBlockedIp(item.address))) {
        throw new Error('Private network URLs are not allowed.');
    }

    return parsed;
};

export const safeFetch = async (rawUrl: string, options: SafeFetchOptions = {}) => {
    const maxRedirects = options.maxRedirects ?? 5;
    let currentUrl = rawUrl;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
        const parsed = await validatePublicHttpUrl(currentUrl);
        const controller = new AbortController();
        const timeoutId = options.timeoutMs
            ? setTimeout(() => controller.abort(), options.timeoutMs)
            : undefined;

        try {
            const response = await fetch(parsed.toString(), {
                method: options.method ?? 'GET',
                headers: options.headers,
                redirect: 'manual',
                signal: controller.signal,
            });

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location) return response;
                currentUrl = new URL(location, parsed).toString();
                continue;
            }

            return response;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    throw new Error(`Too many redirects while fetching ${rawUrl}`);
};
