import { BookmarkRootTitle, ROOT_IDS, ROOT_TITLES } from './bookmarkImport';
import { WeavingProgress } from './structureClient';

export type ScannedBookmark = {
    id: string;
    url: string;
    title: string;
};

export type BookmarkRootSnapshot = {
    bookmarkRoots: Record<string, BookmarkRootTitle>;
    preferredRoots: Record<string, BookmarkRootTitle>;
    availableRoots: BookmarkRootTitle[];
};

const IMPORTED_FOLDER_PATTERN = /^Imported(?: \(\d+\))?$/;
const OVERFLOW_BOOKMARKS_STORAGE_KEY = 'bookmarkWeaverOverflowBookmarks';
const PRE_ORGANIZE_BACKUP_KEY = 'preOrganizeBackup';

export const createEmptyProgress = (): WeavingProgress => ({
    pending: 0,
    pendingRaw: 0,
    enriched: 0,
    embedded: 0,
    errored: 0,
    processing: 0,
    remainingToAssign: 0,
    clusters: 0,
    assigned: 0,
    total: 0,
    isIngesting: false,
    ingestProcessed: 0,
    ingestTotal: 0,
    isClusteringActive: false
});

const isBookmarkRootTitle = (value: string): value is BookmarkRootTitle =>
    ROOT_TITLES.includes(value as BookmarkRootTitle);

const inferPreferredRootFromAncestors = (
    ancestorTitles: string[],
    actualRoot: BookmarkRootTitle
): BookmarkRootTitle => {
    const inferredRoot = ancestorTitles.find(isBookmarkRootTitle);
    if (!inferredRoot || inferredRoot === actualRoot) {
        return actualRoot;
    }

    const hasImportedAncestor = ancestorTitles.some((title) => IMPORTED_FOLDER_PATTERN.test(title));
    const isDirectImportedRoot = ancestorTitles[0] === inferredRoot;

    if (hasImportedAncestor || isDirectImportedRoot) {
        return inferredRoot;
    }

    return actualRoot;
};

export const buildBookmarkRootSnapshot = (tree: any[]): BookmarkRootSnapshot => {
    const bookmarkRoots: Record<string, BookmarkRootTitle> = {};
    const preferredRoots: Record<string, BookmarkRootTitle> = {};
    const availableRoots: BookmarkRootTitle[] = [];
    const topLevelNodes = Array.isArray(tree?.[0]?.children) ? tree[0].children : [];

    topLevelNodes.forEach((node: any) => {
        const rootTitle =
            ROOT_TITLES.find((candidate) => node.id === ROOT_IDS[candidate] || node.title === candidate) ??
            (typeof node.title === 'string' && isBookmarkRootTitle(node.title) ? node.title : null);

        if (!rootTitle) {
            return;
        }

        availableRoots.push(rootTitle);

        const visit = (entry: any, ancestorTitles: string[] = []) => {
            if (entry.url) {
                bookmarkRoots[entry.id] = rootTitle;
                preferredRoots[entry.id] = inferPreferredRootFromAncestors(ancestorTitles, rootTitle);
            }
            if (Array.isArray(entry.children)) {
                const nextAncestorTitles = entry?.title ? [...ancestorTitles, String(entry.title)] : ancestorTitles;
                entry.children.forEach((child: any) =>
                    visit(child, nextAncestorTitles)
                );
            }
        };

        node.children?.forEach((child: any) => visit(child, []));
    });

    return {
        bookmarkRoots,
        preferredRoots,
        availableRoots,
    };
};

export const collectScannedBookmarks = (tree: any[]) => {
    const bookmarks: ScannedBookmark[] = [];
    const traverse = (node: any) => {
        if (node.url) {
            bookmarks.push({ id: node.id, url: node.url, title: node.title });
        }
        if (node.children) {
            node.children.forEach(traverse);
        }
    };
    traverse(tree[0]);
    return bookmarks;
};

const getOverflowStorageKey = (userId: string) => `${OVERFLOW_BOOKMARKS_STORAGE_KEY}:${userId}`;

export const persistOverflowBookmarks = async (userId: string, overflowBookmarks: ScannedBookmark[]) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local || !userId) return;
    await chrome.storage.local.set({ [getOverflowStorageKey(userId)]: overflowBookmarks });
};

export const loadPersistedOverflowBookmarks = async (userId: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local || !userId) {
        return [] as ScannedBookmark[];
    }

    const storageResult = await chrome.storage.local.get([getOverflowStorageKey(userId)]);
    const stored = storageResult[getOverflowStorageKey(userId)];
    return Array.isArray(stored) ? (stored as ScannedBookmark[]) : [];
};

export const clearPersistedOverflowBookmarks = async (userId: string) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local || !userId) return;
    await chrome.storage.local.remove(getOverflowStorageKey(userId));
};

export const savePreOrganizeBackup = async (tree: any[]) => {
    const backup = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        tree,
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [PRE_ORGANIZE_BACKUP_KEY]: backup });
    }

    return backup;
};
