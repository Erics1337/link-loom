import { BookmarkNode } from "../components/BookmarkTree";
import { BookmarkRootTitle } from "./bookmarkImport";

export type BookmarkStats = { duplicates: number; deadLinks: number };

export type StructureAssignment = {
  bookmarkId: string;
  chromeId: string;
  url: string;
  rootTitle: BookmarkRootTitle;
};

const TRACKING_PARAM_NAMES = new Set([
  "gclid",
  "dclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "igshid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "s_kwcid",
  "_hsenc",
  "_hsmi",
]);

const isTrackingParam = (name: string) => {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAM_NAMES.has(lower);
};

const cleanHash = (hash: string): string => {
  if (!hash) return "";

  // Split the hash into path and query if there is a '?'
  const questionMarkIndex = hash.indexOf("?");
  const hashPath =
    questionMarkIndex !== -1 ? hash.slice(0, questionMarkIndex) : hash;
  const hashQuery =
    questionMarkIndex !== -1 ? hash.slice(questionMarkIndex + 1) : "";

  // 1. Process the query part of the hash if it exists
  let cleanedQuery = "";
  if (hashQuery) {
    const queryParams = new URLSearchParams(hashQuery);
    const keptQueryParams = [...queryParams.entries()].filter(
      ([name]) => !isTrackingParam(name),
    );
    if (keptQueryParams.length > 0) {
      keptQueryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      cleanedQuery = "?" + new URLSearchParams(keptQueryParams).toString();
    }
  }

  // 2. Check if the path part of the hash is itself a tracking fragment.
  // e.g. #utm_source=twitter or #xtor=AD-308 or #gclid=123
  const cleanPath = hashPath.startsWith("#") ? hashPath.slice(1) : hashPath;

  let isTrackingPath = false;
  if (isTrackingParam(cleanPath)) {
    isTrackingPath = true;
  } else {
    try {
      const pathParams = new URLSearchParams(cleanPath);
      const keys = Array.from(pathParams.keys());
      if (keys.length > 0 && keys.every((key) => isTrackingParam(key))) {
        isTrackingPath = true;
      }
    } catch {
      // ignore
    }
  }

  if (isTrackingPath) {
    return "";
  }

  const finalPath = hashPath.startsWith("#") ? hashPath.slice(1) : hashPath;
  return finalPath + cleanedQuery;
};

// Mirrored in apps/backend/src/lib/normalizeUrl.ts — the backend hashes the
// normalized URL for the shared embedding cache, so both must stay in sync.
export const normalizeBookmarkUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = cleanHash(parsed.hash);
    const keptParams = [...parsed.searchParams.entries()].filter(
      ([name]) => !isTrackingParam(name),
    );
    keptParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    parsed.search = new URLSearchParams(keptParams).toString();
    if (parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
};

export const countDuplicateAssignments = (
  assignments: StructureAssignment[],
) => {
  const urlCounts = new Map<string, number>();
  assignments.forEach((assignment) => {
    const key = normalizeBookmarkUrl(assignment.url);
    urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
  });
  return Array.from(urlCounts.values()).reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
};

export const collectDuplicateChromeIds = (
  assignments: StructureAssignment[],
) => {
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

export const pruneBookmarksFromTree = (
  nodes: BookmarkNode[],
  bookmarkChromeIdsToRemove: Set<string>,
): BookmarkNode[] => {
  const nextNodes: BookmarkNode[] = [];

  nodes.forEach((node) => {
    const isContainer =
      node.nodeType === "root" ||
      node.nodeType === "folder" ||
      Array.isArray(node.children);
    if (!isContainer) {
      if (
        !bookmarkChromeIdsToRemove.has(getBookmarkChromeId(node) || node.id)
      ) {
        nextNodes.push(node);
      }
      return;
    }

    const nextChildren = pruneBookmarksFromTree(
      node.children || [],
      bookmarkChromeIdsToRemove,
    );
    if (nextChildren.length === 0 && node.nodeType !== "root") {
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

export type FolderMoveOption = {
  id: string;
  label: string;
};

const isContainerNode = (node: BookmarkNode) =>
  node.nodeType === "root" ||
  node.nodeType === "folder" ||
  Boolean(node.children);

export const collectFolderMoveOptions = (
  nodes: BookmarkNode[],
  ancestorTitles: string[] = [],
): FolderMoveOption[] => {
  const options: FolderMoveOption[] = [];

  nodes.forEach((node) => {
    if (node.isSeparator || !isContainerNode(node)) return;

    const title = node.title.trim() || "Untitled Folder";
    const label = [...ancestorTitles, title].join(" / ");
    options.push({ id: node.id, label });

    if (node.children?.length) {
      options.push(
        ...collectFolderMoveOptions(node.children, [...ancestorTitles, title]),
      );
    }
  });

  return options;
};

export const renameNodeTitleInTree = (
  nodes: BookmarkNode[],
  nodeId: string,
  nextTitle: string,
): BookmarkNode[] => {
  const trimmedTitle = nextTitle.trim();

  return nodes.map((node) => {
    if (node.id === nodeId && !node.isSeparator) {
      if (!trimmedTitle || trimmedTitle === node.title) return node;
      const isBookmark = Boolean(node.url);
      return {
        ...node,
        title: trimmedTitle,
        // Bookmark titles are journaled against originalTitle on apply, so a
        // rename must set the new title without clobbering the pre-edit value.
        ...(isBookmark
          ? { originalTitle: node.originalTitle ?? node.title }
          : {}),
      };
    }

    if (node.children) {
      return {
        ...node,
        children: renameNodeTitleInTree(node.children, nodeId, nextTitle),
      };
    }

    return node;
  });
};

export const moveBookmarkInTree = (
  nodes: BookmarkNode[],
  bookmarkId: string,
  targetFolderId: string,
): BookmarkNode[] => {
  let removedNode: BookmarkNode | undefined;

  const removeNode = (list: BookmarkNode[]): BookmarkNode[] =>
    list.reduce<BookmarkNode[]>((acc, node) => {
      if (node.id === bookmarkId && node.url) {
        removedNode = node;
        return acc;
      }
      if (node.children) {
        acc.push({ ...node, children: removeNode(node.children) });
        return acc;
      }
      acc.push(node);
      return acc;
    }, []);

  const withoutNode = removeNode(nodes);
  if (!removedNode) return nodes;

  let inserted = false;
  const insertNode = (list: BookmarkNode[]): BookmarkNode[] =>
    list.map((node) => {
      if (inserted) return node;
      if (node.id === targetFolderId && isContainerNode(node)) {
        inserted = true;
        return {
          ...node,
          children: [...(node.children || []), removedNode as BookmarkNode],
        };
      }
      if (node.children) {
        return { ...node, children: insertNode(node.children) };
      }
      return node;
    });

  const withNode = insertNode(withoutNode);
  // Target folder id didn't match anything in the tree — leave the original
  // tree untouched rather than silently dropping the bookmark.
  return inserted ? withNode : nodes;
};

export const summarizeStructure = (nodes: BookmarkNode[]) => {
  let folders = 0;
  let bookmarks = 0;

  const walk = (branch: BookmarkNode[]) => {
    branch.forEach((node) => {
      const isContainer =
        node.nodeType === "root" ||
        node.nodeType === "folder" ||
        Boolean(node.children);
      if (isContainer) {
        if (node.nodeType !== "root") {
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
