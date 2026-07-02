import { BookmarkNode } from '../components/BookmarkTree';
import { BookmarkRootTitle } from './bookmarkImport';

export type BookmarkStats = { duplicates: number; deadLinks: number };

export type StructureAssignment = {
    bookmarkId: string;
    chromeId: string;
    url: string;
    rootTitle: BookmarkRootTitle;
};

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

// Mirrored in apps/backend/src/lib/normalizeUrl.ts — the backend hashes the
// normalized URL for the shared embedding cache, so both must stay in sync.
export const normalizeBookmarkUrl = (url: string) => {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        const keptParams = [...parsed.searchParams.entries()].filter(
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

export const countDuplicateAssignments = (assignments: StructureAssignment[]) => {
    const urlCounts = new Map<string, number>();
    assignments.forEach((assignment) => {
        const key = normalizeBookmarkUrl(assignment.url);
        urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
    });
    return Array.from(urlCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
};

export const collectDuplicateChromeIds = (assignments: StructureAssignment[]) => {
    const chromeIdsByUrl = new Map<string, string[]>();
    assignments.forEach((assignment) => {
        const key = normalizeBookmarkUrl(assignment.url);
        const existing = chromeIdsByUrl.get(key);
        if (existing) {
            existing.push(assignment.chromeId);
        } else {
            chromeIdsByUrl.set(key, [assignment.chromeId]);
        }
    });

    const duplicateChromeIds: string[] = [];
    chromeIdsByUrl.forEach((ids) => {
        if (ids.length > 1) {
            duplicateChromeIds.push(...ids.slice(1));
        }
    });

    return duplicateChromeIds;
};

export const getBookmarkChromeId = (node: BookmarkNode) => {
    if (node.chromeId) return node.chromeId;
    if (node.url) return node.id;
    return undefined;
};

export const pruneBookmarksFromTree = (nodes: BookmarkNode[], bookmarkChromeIdsToRemove: Set<string>): BookmarkNode[] => {
    const nextNodes: BookmarkNode[] = [];

    nodes.forEach((node) => {
        const isContainer = node.nodeType === 'root' || node.nodeType === 'folder' || Array.isArray(node.children);
        if (!isContainer) {
            if (!bookmarkChromeIdsToRemove.has(getBookmarkChromeId(node) || node.id)) {
                nextNodes.push(node);
            }
            return;
        }

        const nextChildren = pruneBookmarksFromTree(node.children || [], bookmarkChromeIdsToRemove);
        if (nextChildren.length === 0 && node.nodeType !== 'root') {
            return;
        }

        nextNodes.push({ ...node, children: nextChildren });
    });

    return nextNodes;
};

export const countBookmarksInTree = (nodes: BookmarkNode[]): number =>
    nodes.reduce((sum, node) => {
        if (!node.children || node.children.length === 0) {
            return sum + (node.url ? 1 : 0);
        }
        return sum + countBookmarksInTree(node.children);
    }, 0);

export const summarizeStructure = (nodes: BookmarkNode[]) => {
    let folders = 0;
    let bookmarks = 0;

    const walk = (branch: BookmarkNode[]) => {
        branch.forEach((node) => {
            const isContainer = node.nodeType === 'root' || node.nodeType === 'folder' || Boolean(node.children);
            if (isContainer) {
                if (node.nodeType !== 'root') {
                    folders += 1;
                }
                if (node.children?.length) {
                    walk(node.children);
                }
            } else if (node.url) {
                bookmarks += 1;
            }
        });
    };

    walk(nodes);
    return { folders, bookmarks };
};
