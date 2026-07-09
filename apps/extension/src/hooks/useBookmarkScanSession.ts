import { useCallback, useMemo, useRef } from "react";
import { BookmarkRootTitle } from "../lib/bookmarkImport";
import {
  buildBookmarkRootSnapshot,
  ScannedBookmark,
} from "../lib/processingSession";

export const useBookmarkScanSession = () => {
  const pendingBookmarksRef = useRef<ScannedBookmark[]>([]);
  const overflowBookmarksRef = useRef<ScannedBookmark[]>([]);
  const clusterRecoveryTriggered = useRef(false);
  const deadLinkChromeIdsRef = useRef<string[]>([]);
  const deadLinkScanTokenRef = useRef(0);
  const originalTreeRef = useRef<any[]>([]);
  const bookmarkRootMapRef = useRef<Record<string, BookmarkRootTitle>>({});
  const bookmarkPreferredRootMapRef = useRef<Record<string, BookmarkRootTitle>>(
    {},
  );
  const availableRootsRef = useRef<BookmarkRootTitle[]>([]);

  const loadCurrentBookmarkTreeSnapshot = useCallback(async () => {
    if (typeof chrome === "undefined" || !chrome.bookmarks) {
      return [] as any[];
    }

    const tree = await chrome.bookmarks.getTree();
    originalTreeRef.current = tree;
    const snapshot = buildBookmarkRootSnapshot(tree);
    bookmarkRootMapRef.current = snapshot.bookmarkRoots;
    bookmarkPreferredRootMapRef.current = snapshot.preferredRoots;
    availableRootsRef.current = snapshot.availableRoots;
    return tree;
  }, []);

  const ensureCurrentBookmarkTreeSnapshot = useCallback(async () => {
    if (
      originalTreeRef.current.length === 0 ||
      availableRootsRef.current.length === 0 ||
      Object.keys(bookmarkRootMapRef.current).length === 0
    ) {
      await loadCurrentBookmarkTreeSnapshot();
    }
  }, [loadCurrentBookmarkTreeSnapshot]);

  const resetRunRefs = useCallback(() => {
    deadLinkChromeIdsRef.current = [];
    deadLinkScanTokenRef.current += 1;
    clusterRecoveryTriggered.current = false;
    overflowBookmarksRef.current = [];
    pendingBookmarksRef.current = [];
  }, []);

  const resetBookmarkTreeSnapshot = useCallback(() => {
    originalTreeRef.current = [];
    bookmarkRootMapRef.current = {};
    bookmarkPreferredRootMapRef.current = {};
    availableRootsRef.current = [];
  }, []);

  return useMemo(
    () => ({
      pendingBookmarksRef,
      overflowBookmarksRef,
      clusterRecoveryTriggered,
      deadLinkChromeIdsRef,
      deadLinkScanTokenRef,
      originalTreeRef,
      bookmarkRootMapRef,
      bookmarkPreferredRootMapRef,
      availableRootsRef,
      loadCurrentBookmarkTreeSnapshot,
      ensureCurrentBookmarkTreeSnapshot,
      resetRunRefs,
      resetBookmarkTreeSnapshot,
    }),
    [
      ensureCurrentBookmarkTreeSnapshot,
      loadCurrentBookmarkTreeSnapshot,
      resetBookmarkTreeSnapshot,
      resetRunRefs,
    ],
  );
};
