export type BookmarkRootTitle = 'Bookmarks Bar' | 'Other Bookmarks' | 'Mobile Bookmarks';

type BookmarkImportNode =
    | {
          type: 'bookmark';
          title: string;
          url: string;
      }
    | {
          type: 'folder';
          title: string;
          children: BookmarkImportNode[];
      };

export interface ParsedBookmarkExport {
    roots: Partial<Record<BookmarkRootTitle, BookmarkImportNode[]>>;
}

export interface BookmarkImportSummary {
    importedRoots: BookmarkRootTitle[];
    bookmarkCount: number;
    folderCount: number;
}

export interface ApplyParsedBookmarkExportOptions {
    mobileRootStrategy?: 'require_mobile_root' | 'fallback_to_other_bookmarks';
}

export interface BookmarkImportPreviewNode {
    id: string;
    title: string;
    url?: string;
    children?: BookmarkImportPreviewNode[];
}

export const ROOT_TITLES: BookmarkRootTitle[] = ['Bookmarks Bar', 'Other Bookmarks', 'Mobile Bookmarks'];
export const ROOT_IDS: Record<BookmarkRootTitle, string> = {
    'Bookmarks Bar': '1',
    'Other Bookmarks': '2',
    'Mobile Bookmarks': '3',
};

const isRootTitle = (value: string): value is BookmarkRootTitle =>
    ROOT_TITLES.includes(value as BookmarkRootTitle);

const getDirectChildByTagName = (parent: Element, tagName: string) =>
    Array.from(parent.children).find((child) => child.tagName.toUpperCase() === tagName.toUpperCase()) ?? null;

const parseNodeList = (listElement: Element): BookmarkImportNode[] => {
    const parsedNodes: BookmarkImportNode[] = [];
    const children = Array.from(listElement.children);

    for (let index = 0; index < children.length; index += 1) {
        const element = children[index];
        if (element.tagName.toUpperCase() !== 'DT') continue;

        const folderHeading = getDirectChildByTagName(element, 'H3');
        if (folderHeading) {
            // Browsers normalize Netscape bookmark HTML differently:
            // the nested DL can remain a DT sibling or be folded under the DT.
            const nestedListElement =
                getDirectChildByTagName(element, 'DL') ??
                (children[index + 1]?.tagName.toUpperCase() === 'DL' ? children[index + 1] : null);
            const nestedList =
                nestedListElement?.tagName.toUpperCase() === 'DL'
                    ? parseNodeList(nestedListElement)
                    : [];

            parsedNodes.push({
                type: 'folder',
                title: folderHeading.textContent?.trim() || 'Untitled Folder',
                children: nestedList,
            });

            if (nestedListElement === children[index + 1]) {
                index += 1;
            }
            continue;
        }

        const bookmarkLink = getDirectChildByTagName(element, 'A');
        if (!bookmarkLink) continue;

        const url = bookmarkLink.getAttribute('HREF') || bookmarkLink.getAttribute('href') || '';
        if (!url) continue;

        parsedNodes.push({
            type: 'bookmark',
            title: bookmarkLink.textContent?.trim() || url,
            url,
        });
    }

    return parsedNodes;
};

export const parseBookmarkExportText = (fileText: string): ParsedBookmarkExport => {
    const doc = new DOMParser().parseFromString(fileText, 'text/html');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
        throw new Error('The selected file could not be parsed as a bookmark export.');
    }

    const rootList = doc.querySelector('DL');
    if (!rootList) {
        throw new Error('The selected file does not contain a bookmark tree.');
    }

    const topLevelNodes = parseNodeList(rootList);
    const roots: ParsedBookmarkExport['roots'] = {};

    for (const node of topLevelNodes) {
        if (node.type !== 'folder') continue;
        if (!isRootTitle(node.title)) continue;
        roots[node.title] = node.children;
    }

    if (Object.keys(roots).length === 0) {
        throw new Error('No Chrome bookmark roots were found in the selected export.');
    }

    return { roots };
};

export const parseBookmarkExportFile = async (file: File): Promise<ParsedBookmarkExport> => {
    const text = await file.text();
    return parseBookmarkExportText(text);
};

const countBookmarks = (nodes: BookmarkImportNode[]): number =>
    nodes.reduce((total, node) => {
        if (node.type === 'bookmark') return total + 1;
        return total + countBookmarks(node.children);
    }, 0);

const countFolders = (nodes: BookmarkImportNode[]): number =>
    nodes.reduce((total, node) => {
        if (node.type === 'bookmark') return total;
        return total + 1 + countFolders(node.children);
    }, 0);

export const summarizeBookmarkExport = (parsed: ParsedBookmarkExport): BookmarkImportSummary => {
    const importedRoots = ROOT_TITLES.filter((rootTitle) => Array.isArray(parsed.roots[rootTitle]));
    const bookmarkCount = importedRoots.reduce(
        (total, rootTitle) => total + countBookmarks(parsed.roots[rootTitle] || []),
        0
    );
    const folderCount = importedRoots.reduce(
        (total, rootTitle) => total + countFolders(parsed.roots[rootTitle] || []),
        0
    );

    return {
        importedRoots,
        bookmarkCount,
        folderCount,
    };
};

export const getBookmarkRootAvailability = async (): Promise<Record<BookmarkRootTitle, boolean>> => {
    const entries = await Promise.all(
        ROOT_TITLES.map(async (rootTitle) => {
            try {
                await chrome.bookmarks.getChildren(ROOT_IDS[rootTitle]);
                return [rootTitle, true] as const;
            } catch {
                return [rootTitle, false] as const;
            }
        })
    );

    return Object.fromEntries(entries) as Record<BookmarkRootTitle, boolean>;
};

const toPreviewNodes = (nodes: BookmarkImportNode[], parentKey: string): BookmarkImportPreviewNode[] =>
    nodes.map((node, index) => {
        const nodeId = `${parentKey}-${index}`;
        if (node.type === 'bookmark') {
            return {
                id: nodeId,
                title: node.title,
                url: node.url,
            };
        }

        return {
            id: nodeId,
            title: node.title,
            children: toPreviewNodes(node.children, nodeId),
        };
    });

export const parsedBookmarkExportToPreviewNodes = (
    parsed: ParsedBookmarkExport
): BookmarkImportPreviewNode[] =>
    ROOT_TITLES.filter((rootTitle) => Array.isArray(parsed.roots[rootTitle])).map((rootTitle) => ({
        id: `import-root-${rootTitle}`,
        title: rootTitle,
        children: toPreviewNodes(parsed.roots[rootTitle] || [], `import-root-${rootTitle}`),
    }));

const clearBookmarkRoot = async (rootId: string) => {
    const children = await chrome.bookmarks.getChildren(rootId);

    // Delete in reverse order to keep the tree stable while removing siblings.
    for (const child of [...children].reverse()) {
        if (child.url) {
            await chrome.bookmarks.remove(child.id);
        } else {
            await chrome.bookmarks.removeTree(child.id);
        }
    }
};

const createBookmarkNodes = async (parentId: string, nodes: BookmarkImportNode[]) => {
    for (const node of nodes) {
        if (node.type === 'bookmark') {
            await chrome.bookmarks.create({
                parentId,
                title: node.title,
                url: node.url,
            });
            continue;
        }

        const folder = await chrome.bookmarks.create({
            parentId,
            title: node.title,
        });

        await createBookmarkNodes(folder.id, node.children);
    }
};

const removeExistingFolderChildrenByTitle = async (parentId: string, folderTitle: string) => {
    const children = await chrome.bookmarks.getChildren(parentId);
    const matchingFolders = children.filter((child) => !child.url && child.title === folderTitle);

    for (const child of matchingFolders.reverse()) {
        await chrome.bookmarks.removeTree(child.id);
    }
};

export const applyParsedBookmarkExport = async (
    parsed: ParsedBookmarkExport,
    options: ApplyParsedBookmarkExportOptions = {}
): Promise<BookmarkImportSummary> => {
    const summary = summarizeBookmarkExport(parsed);
    if (summary.importedRoots.length === 0) {
        throw new Error('The selected export does not contain any supported Chrome bookmark roots.');
    }

    const rootAvailability = await getBookmarkRootAvailability();

    if (summary.importedRoots.includes('Bookmarks Bar')) {
        await clearBookmarkRoot(ROOT_IDS['Bookmarks Bar']);
        await createBookmarkNodes(ROOT_IDS['Bookmarks Bar'], parsed.roots['Bookmarks Bar'] || []);
    }

    if (summary.importedRoots.includes('Other Bookmarks')) {
        await clearBookmarkRoot(ROOT_IDS['Other Bookmarks']);
        await createBookmarkNodes(ROOT_IDS['Other Bookmarks'], parsed.roots['Other Bookmarks'] || []);
    }

    if (summary.importedRoots.includes('Mobile Bookmarks')) {
        const mobileNodes = parsed.roots['Mobile Bookmarks'] || [];

        if (rootAvailability['Mobile Bookmarks']) {
            await clearBookmarkRoot(ROOT_IDS['Mobile Bookmarks']);
            await createBookmarkNodes(ROOT_IDS['Mobile Bookmarks'], mobileNodes);
        } else if (options.mobileRootStrategy === 'fallback_to_other_bookmarks') {
            const otherRootId = ROOT_IDS['Other Bookmarks'];
            await removeExistingFolderChildrenByTitle(otherRootId, 'Mobile Bookmarks');
            const fallbackFolder = await chrome.bookmarks.create({
                parentId: otherRootId,
                title: 'Mobile Bookmarks',
            });
            await createBookmarkNodes(fallbackFolder.id, mobileNodes);
        } else {
            throw new Error(
                'This Chrome profile does not currently expose the Mobile Bookmarks top-level folder.'
            );
        }
    }

    return summary;
};
