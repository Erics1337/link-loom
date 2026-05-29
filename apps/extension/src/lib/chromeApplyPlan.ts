import { BookmarkNode } from '../components/BookmarkTree';
import { ROOT_IDS, BookmarkRootTitle } from './bookmarkImport';
import { countBookmarksInTree, getBookmarkChromeId } from './bookmarkStructure';

export type ChromeApplyResult = {
    movedCount: number;
    skippedCount: number;
    folderCreateFailures: number;
    shouldWarnAboutPartialApply: boolean;
};

type RootNode = BookmarkNode & { rootTitle: BookmarkRootTitle };

const createFoldersForNodes = async (
    nodes: BookmarkNode[],
    parentId: string,
    rootKeepIds: Set<string>,
    createdFolderIds: Map<string, string>,
    result: ChromeApplyResult,
    isTopLevel = false
) => {
    for (const node of nodes) {
        if (node.url) continue;

        try {
            const folder = await chrome.bookmarks.create({
                parentId,
                title: node.title || 'Untitled Folder',
            });
            createdFolderIds.set(node.id, folder.id);
            if (isTopLevel) {
                rootKeepIds.add(folder.id);
            }
            await createFoldersForNodes(node.children || [], folder.id, rootKeepIds, createdFolderIds, result);
        } catch (error) {
            result.folderCreateFailures += 1;
            console.error(`[ApplyChanges] Failed to create folder ${node.title}`, error);
        }
    }
};

const applyBookmarksForNodes = async (
    nodes: BookmarkNode[],
    parentId: string,
    rootKeepIds: Set<string>,
    createdFolderIds: Map<string, string>,
    result: ChromeApplyResult,
    isTopLevel = false
) => {
    for (const node of nodes) {
        if (node.url) {
            const chromeId = getBookmarkChromeId(node);
            if (!chromeId) {
                result.skippedCount += 1;
                continue;
            }

            try {
                const nextTitle = node.title.trim();
                const currentTitle = (node.originalTitle || node.title).trim();
                if (nextTitle && nextTitle !== currentTitle) {
                    await chrome.bookmarks.update(chromeId, { title: nextTitle });
                }
                await chrome.bookmarks.move(chromeId, { parentId });
                if (isTopLevel) {
                    rootKeepIds.add(chromeId);
                }
                result.movedCount += 1;
            } catch (error) {
                console.warn(`[ApplyChanges] Failed to move bookmark ${chromeId}:`, error);
                result.skippedCount += 1;
            }
            continue;
        }

        const folderId = createdFolderIds.get(node.id);
        if (!folderId) {
            result.skippedCount += countBookmarksInTree(node.children || []);
            continue;
        }

        await applyBookmarksForNodes(node.children || [], folderId, rootKeepIds, createdFolderIds, result);
    }
};

const clearRootChildrenExcept = async (rootId: string, keepIds: Set<string>) => {
    const children = await chrome.bookmarks.getChildren(rootId);
    for (const child of [...children].reverse()) {
        if (keepIds.has(child.id)) continue;
        if (child.url) {
            await chrome.bookmarks.remove(child.id);
        } else {
            await chrome.bookmarks.removeTree(child.id);
        }
    }
};

export const applyChromeBookmarkPlan = async (rootNodes: RootNode[]): Promise<ChromeApplyResult> => {
    const result: ChromeApplyResult = {
        movedCount: 0,
        skippedCount: 0,
        folderCreateFailures: 0,
        shouldWarnAboutPartialApply: false,
    };
    const createdFolderIds = new Map<string, string>();
    const keepIdsByRoot = new Map<BookmarkRootTitle, Set<string>>();

    for (const rootNode of rootNodes) {
        const rootId = ROOT_IDS[rootNode.rootTitle];
        const keepIds = new Set<string>();
        keepIdsByRoot.set(rootNode.rootTitle, keepIds);
        await createFoldersForNodes(rootNode.children || [], rootId, keepIds, createdFolderIds, result, true);
    }

    for (const rootNode of rootNodes) {
        const rootId = ROOT_IDS[rootNode.rootTitle];
        const keepIds = keepIdsByRoot.get(rootNode.rootTitle) || new Set<string>();
        await applyBookmarksForNodes(rootNode.children || [], rootId, keepIds, createdFolderIds, result, true);
    }

    if (result.folderCreateFailures === 0 && result.skippedCount === 0) {
        for (const rootNode of rootNodes) {
            await clearRootChildrenExcept(
                ROOT_IDS[rootNode.rootTitle],
                keepIdsByRoot.get(rootNode.rootTitle) || new Set<string>()
            );
        }
    } else {
        result.shouldWarnAboutPartialApply = true;
    }

    return result;
};
