import { BookmarkRootTitle, ROOT_IDS, ROOT_TITLES } from './bookmarkImport';

export type ScannedBookmark = {
    id: string;
    url: string;
    title: string;
    parentId?: string;
    parentTitle?: string;
};

export type BookmarkRootSnapshot = {
    bookmarkRoots: Record<string, BookmarkRootTitle>;
    preferredRoots: Record<string, BookmarkRootTitle>;
    availableRoots: BookmarkRootTitle[];
};

const IMPORTED_FOLDER_PATTERN = /^Imported(?: \(\d+\))?$/;

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
    if (!tree?.length) {
        return bookmarks;
    }

    const traverse = (node: any, parent?: any) => {
        if (!node) return;
        if (node.url) {
            bookmarks.push({
                id: node.id,
                url: node.url,
                title: node.title ?? '',
                parentId: node.parentId ?? parent?.id,
                parentTitle: parent?.title
            });
        }
        if (node.children) {
            node.children.forEach((child: any) => traverse(child, node));
        }
    };

    tree.forEach((node) => traverse(node));
    return bookmarks;
};
