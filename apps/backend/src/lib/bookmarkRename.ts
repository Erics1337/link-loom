import OpenAI from 'openai';
import { NamingTone } from './clusteringSettings';
import { emojiPrefixLabel } from './emojiNaming';

const OPENAI_RENAME_TIMEOUT_MS = 15000;
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_RENAME_TIMEOUT_MS,
    maxRetries: 1
});

const GENERIC_TITLES = new Set([
    '', 'new tab', 'new page', 'bookmark', 'bookmarks', 'untitled', 'index', 'home', 'homepage'
]);

const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'about',
    'into', 'http', 'https', 'www', 'com', 'org', 'net', 'io', 'co'
]);

const toTitleCase = (value: string) =>
    value
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

const clean = (value: string | null | undefined) =>
    (value ?? '')
        .replace(/^\s*["']|["']\s*$/g, '')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const looksGeneric = (value: string) => {
    const normalized = value.toLowerCase().trim();
    if (GENERIC_TITLES.has(normalized)) return true;
    if (normalized.length < 3) return true;
    if (/^https?:\/\//i.test(normalized)) return true;
    return false;
};

const looksGoodEnough = (value: string) => {
    const normalized = clean(value);
    if (looksGeneric(normalized)) return false;
    if (normalized.length > 90) return false;
    if (/^[a-z0-9\s\-_.]+$/i.test(normalized) && normalized.split(' ').length <= 10) {
        return true;
    }
    return normalized.split(' ').length <= 12;
};

const extractDomainLabel = (rawUrl: string | null | undefined): string | null => {
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

const extractPathTokens = (rawUrl: string | null | undefined): string[] => {
    if (!rawUrl) return [];

    try {
        const parsed = new URL(rawUrl);
        return parsed.pathname
            .split('/')
            .filter(Boolean)
            .join(' ')
            .split(/[-_\s]+/g)
            .map(token => token.toLowerCase())
            .filter(token => token.length >= 3 && !stopWords.has(token))
            .slice(0, 4);
    } catch {
        return [];
    }
};

const getDescriptionTokens = (rawDescription: string | null | undefined): string[] => {
    const description = clean(rawDescription);
    if (!description) return [];

    return description
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter(token => token.length >= 4 && !stopWords.has(token))
        .slice(0, 4);
};

const getToneInstruction = (tone: NamingTone): string => {
    switch (tone) {
        case 'playful':
            return 'Use playful but searchable phrasing. Keep at least one obvious topic word.';
        case 'balanced':
            return 'Use concise modern phrasing with a little personality.';
        case 'clear':
        default:
            return 'Use clear literal phrasing optimized for findability.';
    }
};

const heuristicRename = (params: {
    currentTitle?: string | null;
    description?: string | null;
    url?: string | null;
    clusterName?: string | null;
}) => {
    const currentTitle = clean(params.currentTitle);
    if (currentTitle && looksGoodEnough(currentTitle)) {
        return currentTitle;
    }

    const domain = extractDomainLabel(params.url);
    const pathTokens = extractPathTokens(params.url);
    const descriptionTokens = getDescriptionTokens(params.description);
    const cluster = clean(params.clusterName);

    const titlePieces = [
        ...pathTokens,
        ...descriptionTokens,
    ].slice(0, 3);

    if (titlePieces.length > 0) {
        return toTitleCase(titlePieces.join(' '));
    }

    if (cluster && !looksGeneric(cluster)) {
        return cluster;
    }

    if (domain) {
        return toTitleCase(domain);
    }

    if (currentTitle) {
        return currentTitle;
    }

    return 'Saved Link';
};

export interface BookmarkRenameContext {
    currentTitle?: string | null;
    description?: string | null;
    url?: string | null;
    clusterName?: string | null;
    namingTone: NamingTone;
    useEmojiNames?: boolean;
}

export const generateBookmarkRename = async (context: BookmarkRenameContext): Promise<string> => {
    const currentTitle = clean(context.currentTitle);
    const fallback = heuristicRename(context);
    const finalize = (rawTitle: string) => {
        const cleanedTitle = clean(rawTitle);
        if (!cleanedTitle) return cleanedTitle;
        if (!context.useEmojiNames) return cleanedTitle;
        return emojiPrefixLabel(cleanedTitle, `${clean(context.clusterName)} ${clean(context.url)}`, 'bookmark');
    };

    if (currentTitle && looksGoodEnough(currentTitle) && !context.useEmojiNames) {
        return currentTitle;
    }

    if (!process.env.OPENAI_API_KEY) {
        return finalize(fallback);
    }

    try {
        const prompt = [
            'Rewrite this bookmark title to be concise and easy to find later.',
            getToneInstruction(context.namingTone),
            'Rules:',
            '- Return plain text only.',
            '- Max 8 words.',
            '- Preserve key entities (product, person, company, framework names).',
            '- Avoid generic output like "Home" or "Bookmark".',
            `Current title: ${currentTitle || '(empty)'}`,
            `Folder context: ${clean(context.clusterName) || '(none)'}`,
            `Description: ${clean(context.description) || '(none)'}`,
            `URL: ${clean(context.url) || '(none)'}`,
        ].join('\n');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: context.namingTone === 'clear' ? 0.2 : context.namingTone === 'balanced' ? 0.5 : 0.8,
        });

        const suggestion = clean(response.choices[0]?.message?.content);
        if (!suggestion || looksGeneric(suggestion)) {
            return finalize(fallback);
        }

        return finalize(suggestion);
    } catch {
        return finalize(fallback);
    }
};
