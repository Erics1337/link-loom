export const toTitleCase = (value: string) =>
    value
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

export const extractPrimaryDomainLabel = (
    rawUrl: string | null | undefined
): string | null => {
    if (!rawUrl) return null;
    try {
        const hostname = new URL(rawUrl).hostname.replace(/^www\./i, '');
        const parts = hostname.split('.').filter(Boolean);
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        return parts[parts.length - 2];
    } catch {
        return null;
    }
};
