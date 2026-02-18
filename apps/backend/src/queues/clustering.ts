import { Job } from 'bullmq';
import { supabase } from '../db';
import { kmeans } from 'ml-kmeans';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import { isUserCancelled } from '../lib/cancellation';
import { ClusteringDensityProfile, ClusteringSettings, getDensityProfile, normalizeClusteringSettings } from '../lib/clusteringSettings';

import fs from 'fs';
import path from 'path';

const logFile = path.resolve(process.cwd(), 'clustering-debug.log');

function log(msg: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
    console.log(msg);
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface ClusteringJobData {
    userId: string;
    clusteringSettings?: ClusteringSettings;
}

interface ClusterGroup {
    ids: string[];
    vecs: number[][];
}

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(raw ?? `${fallback}`, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return parsed;
};

const CLUSTER_NAME_CONCURRENCY = parsePositiveInt(process.env.CLUSTER_NAME_CONCURRENCY, 4);
const CLUSTER_NAME_MAX_RETRIES = parsePositiveInt(process.env.CLUSTER_NAME_MAX_RETRIES, 5);
const CLUSTER_NAME_BASE_BACKOFF_MS = parsePositiveInt(process.env.CLUSTER_NAME_BASE_BACKOFF_MS, 400);
const CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI = parsePositiveInt(process.env.CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI, 12);
const CLUSTER_NAME_CONTEXT_SAMPLE_SIZE = parsePositiveInt(process.env.CLUSTER_NAME_CONTEXT_SAMPLE_SIZE, 20);

// Concurrency limit for cluster naming and cluster creation requests.
const limit = pLimit(CLUSTER_NAME_CONCURRENCY);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clusterNameCache = new Map<string, string>();
let nextAllowedOpenAIRequestAt = 0;

const TITLE_TOKEN_STOP_WORDS = new Set([
    'and', 'for', 'the', 'with', 'from', 'that', 'this', 'your', 'you', 'are',
    'how', 'why', 'what', 'when', 'where', 'best', 'guide', 'tips', 'new',
    'bookmark', 'bookmarks', 'folder', 'page', 'home', 'official'
]);

const GENERIC_TITLES = new Set(['new folder', 'untitled', 'bookmark', '']);
const GENERIC_RESPONSES = new Set(['new folder', 'untitled', 'bookmarks', 'miscellaneous', 'folder', 'general', '']);

const toTitleCase = (value: string) =>
    value
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

const extractPrimaryDomainLabel = (rawUrl: string | null | undefined): string | null => {
    if (!rawUrl) return null;
    try {
        const hostname = new URL(rawUrl).hostname.replace(/^www\./i, '');
        const pieces = hostname.split('.').filter(Boolean);
        if (pieces.length === 0) return null;
        if (pieces.length === 1) return pieces[0];
        return pieces[pieces.length - 2];
    } catch {
        return null;
    }
};

const normalizeVector = (vector: number[]): number[] => {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
    if (norm <= Number.EPSILON) return vector;
    return vector.map(value => value / norm);
};

const parseVector = (raw: unknown): number[] | null => {
    let candidate: unknown = raw;
    if (typeof raw === 'string') {
        try {
            candidate = JSON.parse(raw);
        } catch (e) {
            log(`Failed to parse vector JSON: ${e}`);
            return null;
        }
    }

    if (!Array.isArray(candidate) || candidate.length === 0) return null;

    const values: number[] = [];
    for (const value of candidate) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return null;
        }
        values.push(value);
    }

    return values;
};

const sampleBookmarkIds = (bookmarkIds: string[], sampleSize: number): string[] => {
    if (bookmarkIds.length <= sampleSize) return bookmarkIds;

    const step = bookmarkIds.length / sampleSize;
    const sampled = new Set<string>();

    for (let i = 0; i < sampleSize; i++) {
        const idx = Math.min(Math.floor(i * step), bookmarkIds.length - 1);
        sampled.add(bookmarkIds[idx]);
    }

    return Array.from(sampled);
};

const getNamingToneInstruction = (settings: ClusteringSettings): string => {
    switch (settings.namingTone) {
        case 'balanced':
            return 'Tone: concise and modern. Slight personality is allowed, but keep the category obvious.';
        case 'playful':
            return 'Tone: creative and witty, but keep findability high by including a clear topic anchor, ideally like "Creative Name (Topic)".';
        case 'clear':
        default:
            return 'Tone: clear and literal. Prefer obvious category labels over clever wording.';
    }
};

const getOrganizationInstruction = (settings: ClusteringSettings): string => {
    if (settings.organizationMode === 'category') {
        return 'Organization mode: category-first. Prefer broad categories over niche topics.';
    }

    return 'Organization mode: topic-first. Prefer specific topics over broad categories.';
};

const chooseSplitK = (count: number, profile: ClusteringDensityProfile): number => {
    if (count <= profile.targetLeafSize) return 1;

    const estimated = Math.ceil(count / profile.targetLeafSize);
    return Math.max(2, Math.min(profile.maxChildren, estimated, count));
};

const rebalanceSmallGroups = (groups: ClusterGroup[], minChildSize: number): ClusterGroup[] => {
    if (groups.length <= 1) return groups;

    const largeGroups = groups.filter(group => group.ids.length >= minChildSize);
    const smallGroups = groups.filter(group => group.ids.length < minChildSize);

    if (smallGroups.length === 0 || largeGroups.length === 0) {
        return groups;
    }

    const sortLargeGroups = () => {
        largeGroups.sort((a, b) => b.ids.length - a.ids.length);
    };

    sortLargeGroups();

    for (const small of smallGroups) {
        const target = largeGroups[0];
        target.ids.push(...small.ids);
        target.vecs.push(...small.vecs);
        sortLargeGroups();
    }

    return largeGroups;
};

const generateHeuristicClusterName = (
    bookmarks: Array<{ title?: string | null; description?: string | null; url?: string | null }>
) => {
    const domainCounts = new Map<string, number>();
    const tokenCounts = new Map<string, number>();

    for (const bookmark of bookmarks) {
        const domain = extractPrimaryDomainLabel(bookmark.url);
        if (domain) {
            domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
        }

        const combinedText = `${bookmark.title ?? ''} ${bookmark.description ?? ''}`.toLowerCase();
        const tokens = combinedText.match(/[a-z0-9]{3,}/g) ?? [];
        for (const token of tokens) {
            if (TITLE_TOKEN_STOP_WORDS.has(token)) continue;
            tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
        }
    }

    const dominantDomain = Array.from(domainCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (dominantDomain && dominantDomain[1] >= Math.max(2, Math.ceil(bookmarks.length * 0.45))) {
        return toTitleCase(dominantDomain[0]);
    }

    const topTokens = Array.from(tokenCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .filter(([, count]) => count >= 2)
        .slice(0, 2)
        .map(([token]) => token);

    if (topTokens.length > 0) {
        return toTitleCase(topTokens.join(' '));
    }

    if (dominantDomain) {
        return toTitleCase(dominantDomain[0]);
    }

    return 'General';
};

const getRetryAfterMs = (err: any): number | null => {
    const retryAfterHeader =
        err?.headers?.['retry-after'] ??
        err?.headers?.get?.('retry-after');

    if (!retryAfterHeader) return null;
    const parsed = Number.parseInt(retryAfterHeader, 10);
    if (Number.isNaN(parsed)) return null;
    return parsed * 1000;
};

const createCluster = async (userId: string, parentId: string | null, name: string): Promise<string | null> => {
    const { data: newCluster, error } = await supabase
        .from('clusters')
        .insert({
            user_id: userId,
            name,
            parent_id: parentId,
        })
        .select('id')
        .single();

    if (error || !newCluster?.id) {
        log(`Error creating cluster: ${JSON.stringify(error)}`);
        return null;
    }

    return newCluster.id;
};

const assignBookmarksToCluster = async (bookmarkIds: string[], clusterId: string) => {
    if (bookmarkIds.length === 0) return;

    const assignments = bookmarkIds.map(bookmarkId => ({
        cluster_id: clusterId,
        bookmark_id: bookmarkId,
    }));

    const { error } = await supabase
        .from('cluster_assignments')
        .insert(assignments);

    if (error) {
        log(`Batch insert error: ${JSON.stringify(error)}`);
    }
};

const assignLeafGroup = async (
    bookmarkIds: string[],
    parentId: string | null,
    userId: string,
    settings: ClusteringSettings
) => {
    let leafClusterId = parentId;

    if (!leafClusterId) {
        const fallbackName = await generateClusterName(bookmarkIds, settings);
        leafClusterId = await createCluster(userId, null, fallbackName);
    }

    if (!leafClusterId) {
        log(`Unable to assign ${bookmarkIds.length} bookmarks for user ${userId}: no target cluster`);
        return;
    }

    await assignBookmarksToCluster(bookmarkIds, leafClusterId);
};

async function generateClusterName(bookmarkIds: string[], settings: ClusteringSettings): Promise<string> {
    const sampledIds = sampleBookmarkIds(bookmarkIds, CLUSTER_NAME_CONTEXT_SAMPLE_SIZE);

    // Fetch bookmark data including URL for fallback.
    const { data: bks } = await supabase
        .from('bookmarks')
        .select('title, description, url')
        .in('id', sampledIds);

    if (!bks || bks.length === 0) return 'General';

    const meaningfulBookmarks = bks.filter(bookmark => {
        const title = (bookmark.title || '').toLowerCase().trim();
        return title && !GENERIC_TITLES.has(title);
    });

    const bookmarkInfoList = meaningfulBookmarks.length > 0
        ? meaningfulBookmarks
        : bks;

    const contextLines = bookmarkInfoList
        .map(bookmark => {
            const title = bookmark.title?.trim() || '';
            const description = bookmark.description?.trim() || '';
            const url = bookmark.url || '';

            let domain = '';
            try {
                domain = new URL(url).hostname.replace(/^www\./i, '');
            } catch {
                // ignored: best-effort extraction only
            }

            if (title && description) {
                return `- ${title}: ${description}`;
            }

            if (title) {
                return `- ${title}${domain ? ` (${domain})` : ''}`;
            }

            if (domain) {
                return `- ${domain}${description ? `: ${description}` : ''}`;
            }

            return null;
        })
        .filter((line): line is string => Boolean(line));

    if (contextLines.length === 0) {
        return generateHeuristicClusterName(bks as Array<{ title?: string | null; description?: string | null; url?: string | null }>);
    }

    const cacheKey = `${settings.namingTone}|${settings.organizationMode}|${contextLines.join('\n').toLowerCase()}`;
    const cachedName = clusterNameCache.get(cacheKey);
    if (cachedName) return cachedName;

    // Avoid expensive naming calls for smaller groups where local heuristics are good enough.
    if (bookmarkIds.length < CLUSTER_NAME_MIN_BOOKMARKS_FOR_AI || !process.env.OPENAI_API_KEY) {
        const heuristicName = generateHeuristicClusterName(bks as Array<{ title?: string | null; description?: string | null; url?: string | null }>);
        clusterNameCache.set(cacheKey, heuristicName);
        return heuristicName;
    }

    const prompt = [
        'Generate a short, descriptive folder name for the bookmark group below.',
        getOrganizationInstruction(settings),
        getNamingToneInstruction(settings),
        'Constraints:',
        '- Return plain text only (no quotes, markdown, or numbering).',
        '- Keep it concise (max 5 words).',
        '- Avoid generic names like "New Folder" or "Miscellaneous".',
        '- The result must be easy to scan and find later.',
        'Bookmarks:',
        ...contextLines,
    ].join('\n');

    let retries = 0;

    while (retries < CLUSTER_NAME_MAX_RETRIES) {
        try {
            const waitForSharedWindow = Math.max(0, nextAllowedOpenAIRequestAt - Date.now());
            if (waitForSharedWindow > 0) {
                await delay(waitForSharedWindow);
            }

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
            });

            let name = response.choices[0].message.content?.trim() || '';
            name = name.replace(/^\s*["']|["']\s*$/g, '').replace(/\*\*/g, '').trim();

            if (!name || GENERIC_RESPONSES.has(name.toLowerCase())) {
                const heuristicName = generateHeuristicClusterName(bks as Array<{ title?: string | null; description?: string | null; url?: string | null }>);
                clusterNameCache.set(cacheKey, heuristicName);
                return heuristicName;
            }

            clusterNameCache.set(cacheKey, name);
            return name;
        } catch (e: any) {
            if (e.status === 429) {
                retries++;
                const retryAfterMs = getRetryAfterMs(e);
                const exponentialMs = CLUSTER_NAME_BASE_BACKOFF_MS * Math.pow(2, retries - 1);
                const jitterMs = Math.floor(Math.random() * 250);
                const wait = Math.max(retryAfterMs ?? 0, exponentialMs) + jitterMs;
                nextAllowedOpenAIRequestAt = Date.now() + wait;
                log(`OpenAI rate-limited cluster naming (attempt ${retries}/${CLUSTER_NAME_MAX_RETRIES}). Retrying in ${wait}ms...`);
                await delay(wait);
                continue;
            }

            log(`OpenAI naming error: ${JSON.stringify(e)}`);
            return generateHeuristicClusterName(bks as Array<{ title?: string | null; description?: string | null; url?: string | null }>);
        }
    }

    return generateHeuristicClusterName(bks as Array<{ title?: string | null; description?: string | null; url?: string | null }>);
}

// Recursive function to cluster bookmarks.
async function recursiveCluster(
    bookmarkIds: string[],
    vectors: number[][],
    parentId: string | null,
    userId: string,
    settings: ClusteringSettings
) {
    if (isUserCancelled(userId)) {
        log(`[CLUSTERING] Cancelled recursion for user ${userId}`);
        return;
    }

    const profile = getDensityProfile(settings);

    // Base case: stop splitting when node is already small enough for selected density.
    if (bookmarkIds.length <= profile.targetLeafSize) {
        await assignLeafGroup(bookmarkIds, parentId, userId, settings);
        return;
    }

    const k = chooseSplitK(bookmarkIds.length, profile);
    if (k < 2) {
        await assignLeafGroup(bookmarkIds, parentId, userId, settings);
        return;
    }

    try {
        log(`Running k-means on ${bookmarkIds.length} items with k=${k}`);
        const result = kmeans(vectors, k, { initialization: 'kmeans++' });

        const groupsByCluster: Record<number, ClusterGroup> = {};
        for (let i = 0; i < result.clusters.length; i++) {
            const clusterIdx = result.clusters[i];
            if (!groupsByCluster[clusterIdx]) {
                groupsByCluster[clusterIdx] = { ids: [], vecs: [] };
            }

            groupsByCluster[clusterIdx].ids.push(bookmarkIds[i]);
            groupsByCluster[clusterIdx].vecs.push(vectors[i]);
        }

        let groups = Object.values(groupsByCluster);
        groups = rebalanceSmallGroups(groups, profile.minChildSize);

        // If split collapses to one group, treat as a leaf to avoid useless folder depth.
        if (groups.length <= 1) {
            await assignLeafGroup(bookmarkIds, parentId, userId, settings);
            return;
        }

        const createdClusters = await Promise.all(
            groups.map(group =>
                limit(async () => {
                    const name = await generateClusterName(group.ids, settings);
                    const clusterId = await createCluster(userId, parentId, name);
                    return { clusterId, group };
                })
            )
        );

        await Promise.all(
            createdClusters.map(async item => {
                if (!item.clusterId) {
                    await assignLeafGroup(item.group.ids, parentId, userId, settings);
                    return;
                }

                await recursiveCluster(item.group.ids, item.group.vecs, item.clusterId, userId, settings);
            })
        );
    } catch (e: any) {
        log(`Clustering error: ${e}`);
        await assignLeafGroup(bookmarkIds, parentId, userId, settings);
    }
}

export const clusteringProcessor = async (job: Job<ClusteringJobData>) => {
    const { userId } = job.data;
    const settings = normalizeClusteringSettings(job.data.clusteringSettings);
    log(
        `Clustering bookmarks for user ${userId} (density=${settings.folderDensity}, tone=${settings.namingTone}, mode=${settings.organizationMode})`
    );

    if (isUserCancelled(userId)) {
        log(`[CLUSTERING] Cancelled before start for user ${userId}`);
        return;
    }

    // Fetch all embedded bookmarks for user with their vectors via join.
    let userBookmarks: any[] = [];
    let from = 0;
    const size = 1000;

    while (true) {
        log(`Fetching bookmarks range ${from}-${from + size - 1}...`);
        const { data: chunk, error } = await supabase
            .from('bookmarks')
            .select(`
                id,
                shared_links!content_hash (vector)
            `)
            .eq('user_id', userId)
            .range(from, from + size - 1);

        if (error) {
            log(`DB Error ${JSON.stringify(error)}`);
            return;
        }

        if (!chunk || chunk.length === 0) break;

        userBookmarks = userBookmarks.concat(chunk);

        if (chunk.length < size) break;
        from += size;

        if (isUserCancelled(userId)) {
            log(`[CLUSTERING] Cancelled during fetch for user ${userId}`);
            return;
        }
    }

    if (!userBookmarks || userBookmarks.length === 0) {
        log('No user bookmarks found');
        return;
    }

    log(`Fetched ${userBookmarks.length} bookmarks from DB`);

    const validBookmarks = userBookmarks.filter(
        bookmark => bookmark.shared_links && (bookmark.shared_links as { vector?: unknown }).vector
    );
    log(`Valid bookmarks with vectors: ${validBookmarks.length}`);

    if (validBookmarks.length === 0) {
        log('No valid bookmarks with vectors found');
        return;
    }

    const parsedRows: Array<{ id: string; vector: number[] }> = [];

    for (const bookmark of validBookmarks) {
        const rawVector = (bookmark.shared_links as { vector?: unknown })?.vector;
        const parsedVector = parseVector(rawVector);
        if (!parsedVector) continue;

        parsedRows.push({
            id: bookmark.id,
            vector: normalizeVector(parsedVector),
        });
    }

    if (parsedRows.length === 0) {
        log('No parseable vectors were available after normalization step');
        return;
    }

    const ids = parsedRows.map(row => row.id);
    const vectors = parsedRows.map(row => row.vector);

    await recursiveCluster(ids, vectors, null, userId, settings);
    log('Clustering completed');
};
