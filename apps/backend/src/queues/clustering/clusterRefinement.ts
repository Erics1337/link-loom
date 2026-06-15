import OpenAI from 'openai';

import { supabase } from '../../db';
import {
    ClusteringSettings,
    getDensityProfile
} from '../../lib/clusteringSettings';
import { extractPrimaryDomainLabel } from '../../lib/textLabels';
import {
    ClusterGroup,
    rankIdsByCentroid
} from './clusterAlgorithm';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(raw ?? `${fallback}`, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return parsed;
};

const CLUSTER_REFINEMENT_MIN_BOOKMARKS = parsePositiveInt(
    process.env.CLUSTER_REFINEMENT_MIN_BOOKMARKS,
    24
);
const CLUSTER_REFINEMENT_SAMPLE_SIZE = parsePositiveInt(
    process.env.CLUSTER_REFINEMENT_SAMPLE_SIZE,
    5
);

type BookmarkSummary = {
    title?: string | null;
    description?: string | null;
    url?: string | null;
};

type RefinementResponse = {
    labels?: Array<{ groupIndex?: unknown; name?: unknown }>;
    merges?: Array<{
        sourceGroupIndex?: unknown;
        targetGroupIndex?: unknown;
        reason?: unknown;
    }>;
};

const cleanSuggestedName = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const cleaned = value
        .replace(/^\s*["']|["']\s*$/g, '')
        .replace(/\*\*/g, '')
        .trim();
    if (!cleaned || cleaned.length > 60) return null;
    return cleaned;
};

const loadBookmarkSummaries = async (
    bookmarkIds: string[]
): Promise<Map<string, BookmarkSummary>> => {
    if (bookmarkIds.length === 0) return new Map();

    const { data, error } = await supabase
        .from('bookmarks')
        .select('id, title, description, url')
        .in('id', bookmarkIds);

    if (error) {
        throw new Error(`Failed to load bookmark summaries for cluster refinement: ${error.message}`);
    }

    const summaries = new Map<string, BookmarkSummary>();
    for (const bookmark of data ?? []) {
        summaries.set(bookmark.id, bookmark);
    }
    return summaries;
};

const formatBookmarkLine = (bookmark: BookmarkSummary) => {
    const title = bookmark.title?.trim() || 'Untitled';
    const description = bookmark.description?.trim();
    const domain = extractPrimaryDomainLabel(bookmark.url);

    if (description && domain) return `${title}: ${description} (${domain})`;
    if (description) return `${title}: ${description}`;
    if (domain) return `${title} (${domain})`;
    return title;
};

const getLabelToneInstruction = (settings: ClusteringSettings) => {
    switch (settings.namingTone) {
        case 'balanced':
            return 'Label tone: concise and modern, with slight personality allowed.';
        case 'playful':
            return 'Label tone: creative and witty, but keep a clear topic anchor.';
        case 'clear':
        default:
            return 'Label tone: clear and literal; prefer obvious labels over clever wording.';
    }
};

const buildGroupContext = async (groups: ClusterGroup[]) => {
    const representativeIdsByGroup = groups.map((group) =>
        rankIdsByCentroid(
            group.ids,
            group.vecs,
            CLUSTER_REFINEMENT_SAMPLE_SIZE
        )
    );
    const representativeIds = Array.from(
        new Set(representativeIdsByGroup.flat())
    );
    const summaries = await loadBookmarkSummaries(representativeIds);

    return representativeIdsByGroup.map((ids, index) => {
        const lines = ids
            .map((id) => summaries.get(id))
            .filter((bookmark): bookmark is BookmarkSummary => Boolean(bookmark))
            .map(formatBookmarkLine);

        return [
            `Group ${index}: ${groups[index].ids.length} bookmarks`,
            ...lines.map((line) => `- ${line}`)
        ].join('\n');
    });
};

const mergeGroups = (
    groups: ClusterGroup[],
    sourceIndex: number,
    targetIndex: number
) => {
    const source = groups[sourceIndex];
    const target = groups[targetIndex];
    target.ids.push(...source.ids);
    target.vecs.push(...source.vecs);
    groups.splice(sourceIndex, 1);
};

const applySafeRefinement = (
    groups: ClusterGroup[],
    response: RefinementResponse,
    settings: ClusteringSettings,
    log: (msg: string) => void
) => {
    const profile = getDensityProfile(settings);
    const maxMergedSize = Math.max(
        profile.targetLeafSize * 2,
        profile.targetLeafSize + profile.minChildSize
    );

    for (const label of response.labels ?? []) {
        const groupIndex =
            typeof label.groupIndex === 'number' ? label.groupIndex : -1;
        const name = cleanSuggestedName(label.name);
        if (!name || !groups[groupIndex]) continue;
        groups[groupIndex].suggestedName = name;
    }

    const mergeCandidates = [...(response.merges ?? [])]
        .map((merge) => ({
            source:
                typeof merge.sourceGroupIndex === 'number'
                    ? merge.sourceGroupIndex
                    : -1,
            target:
                typeof merge.targetGroupIndex === 'number'
                    ? merge.targetGroupIndex
                    : -1
        }))
        .filter(({ source, target }) => source >= 0 && target >= 0 && source !== target)
        .sort((a, b) => b.source - a.source);

    let appliedMerges = 0;
    for (const { source, target } of mergeCandidates) {
        if (!groups[source] || !groups[target]) continue;
        if (groups[source].ids.length + groups[target].ids.length > maxMergedSize) {
            continue;
        }

        mergeGroups(groups, source, target);
        appliedMerges++;
    }

    if (appliedMerges > 0) {
        log(`Applied ${appliedMerges} LLM sibling cluster merge${appliedMerges === 1 ? '' : 's'}`);
    }

    return groups;
};

export const refineSiblingGroupsWithLLM = async (
    groups: ClusterGroup[],
    settings: ClusteringSettings,
    log: (msg: string) => void
): Promise<ClusterGroup[]> => {
    const totalBookmarks = groups.reduce((sum, group) => sum + group.ids.length, 0);
    if (
        groups.length <= 1 ||
        totalBookmarks < CLUSTER_REFINEMENT_MIN_BOOKMARKS ||
        !process.env.OPENAI_API_KEY
    ) {
        return groups;
    }

    try {
        const groupContext = await buildGroupContext(groups);
        if (groupContext.every((context) => !context.includes('- '))) {
            return groups;
        }

        const prompt = [
            'Review these sibling bookmark groups from a semantic clustering pass.',
            'Return JSON only with this shape:',
            '{"labels":[{"groupIndex":0,"name":"Short Folder Name"}],"merges":[{"sourceGroupIndex":1,"targetGroupIndex":0,"reason":"duplicate topic"}]}',
            'Rules:',
            `- ${getLabelToneInstruction(settings)}`,
            '- Suggest labels that are concise, literal, and easy to scan.',
            '- Suggest merges only when two sibling groups are clearly duplicate or near-duplicate topics.',
            '- Do not suggest moving individual bookmarks.',
            '- Use zero-based group indexes exactly as provided.',
            'Groups:',
            ...groupContext
        ].join('\n\n');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt }]
        });
        const content = response.choices?.[0]?.message?.content ?? '';
        const parsed = JSON.parse(content) as RefinementResponse;
        return applySafeRefinement(groups, parsed, settings, log);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        log(`LLM sibling refinement skipped after error: ${message}`);
        return groups;
    }
};
