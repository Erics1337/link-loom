const TRACKING_PARAM_NAMES = new Set([
    'gclid',
    'dclid',
    'wbraid',
    'gbraid',
    'fbclid',
    'msclkid',
    'twclid',
    'igshid',
    'yclid',
    'mc_cid',
    'mc_eid',
    's_kwcid',
    '_hsenc',
    '_hsmi',
]);

const isTrackingParam = (name: string) => {
    const lower = name.toLowerCase();
    return lower.startsWith('utm_') || TRACKING_PARAM_NAMES.has(lower);
};

/**
 * Canonicalizes a bookmark URL before hashing so tracking-param and host-case
 * variants of the same page share one shared_links cache entry.
 *
 * Mirrored in apps/extension/src/lib/bookmarkStructure.ts (normalizeBookmarkUrl);
 * every sha256 used as a shared_links id must go through this first.
 */
export const normalizeBookmarkUrl = (url: string) => {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        const keptParams = Array.from(parsed.searchParams.entries()).filter(
            ([name]) => !isTrackingParam(name)
        );
        keptParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        parsed.search = new URLSearchParams(keptParams).toString();
        if (parsed.pathname.endsWith('/')) {
            parsed.pathname = parsed.pathname.slice(0, -1);
        }
        return parsed.toString();
    } catch {
        return url.trim();
    }
};
