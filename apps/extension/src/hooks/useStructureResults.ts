import { Dispatch, MutableRefObject, SetStateAction, useCallback } from "react";
import { BookmarkNode } from "../components/BookmarkTree";
import { BookmarkRootTitle } from "../lib/bookmarkImport";
import { BookmarkStats, StructureAssignment } from "../lib/bookmarkStructure";
import { StructureClient } from "../lib/structureClient";
import { buildStructurePreview } from "../lib/structurePreviewBuilder";
import {
  loadPersistedOverflowBookmarks,
  ScannedBookmark,
} from "../lib/processingSession";
import {
  AppStatus,
  BACKEND_UNAVAILABLE_MESSAGE,
  DEFAULT_ROOT_TITLE,
  isAbortError,
  isFailedFetchError,
  STRUCTURE_REQUEST_TIMEOUT_MS,
} from "./useBookmarkWeaverTypes";

type UseStructureResultsArgs = {
  userId: string;
  structureClient: StructureClient;
  ensureCurrentBookmarkTreeSnapshot: () => Promise<void>;
  overflowBookmarksRef: MutableRefObject<ScannedBookmark[]>;
  availableRootsRef: MutableRefObject<BookmarkRootTitle[]>;
  bookmarkRootMapRef: MutableRefObject<Record<string, BookmarkRootTitle>>;
  bookmarkPreferredRootMapRef: MutableRefObject<
    Record<string, BookmarkRootTitle>
  >;
  originalTreeRef: MutableRefObject<any[]>;
  deadLinkChromeIdsRef: MutableRefObject<string[]>;
  setClusters: Dispatch<SetStateAction<BookmarkNode[]>>;
  setStructureAssignments: Dispatch<SetStateAction<StructureAssignment[]>>;
  setStats: Dispatch<SetStateAction<BookmarkStats>>;
  setHasCachedResults: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<AppStatus>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
};

export const useStructureResults = ({
  userId,
  structureClient,
  ensureCurrentBookmarkTreeSnapshot,
  overflowBookmarksRef,
  availableRootsRef,
  bookmarkRootMapRef,
  bookmarkPreferredRootMapRef,
  originalTreeRef,
  deadLinkChromeIdsRef,
  setClusters,
  setStructureAssignments,
  setStats,
  setHasCachedResults,
  setStatus,
  setErrorMessage,
}: UseStructureResultsArgs) => {
  const fetchResults = useCallback(
    async (idOverride?: string, silent = false) => {
      const targetId = idOverride || userId;
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        STRUCTURE_REQUEST_TIMEOUT_MS,
      );
      try {
        await ensureCurrentBookmarkTreeSnapshot();
        if (overflowBookmarksRef.current.length === 0 && targetId) {
          overflowBookmarksRef.current =
            await loadPersistedOverflowBookmarks(targetId);
        }

        const res = await structureClient.fetchStructure(
          targetId,
          controller.signal,
        );
        if (!res.ok) {
          throw new Error(`Structure fetch failed: ${res.status}`);
        }
        const data = await res.json();

        const { rootNodes, assignmentSummaries, duplicateCount } =
          buildStructurePreview({
            data,
            availableRoots: availableRootsRef.current,
            bookmarkRootMap: bookmarkRootMapRef.current,
            bookmarkPreferredRootMap: bookmarkPreferredRootMapRef.current,
            overflowBookmarks: overflowBookmarksRef.current,
            originalTree: originalTreeRef.current,
            defaultRootTitle: DEFAULT_ROOT_TITLE,
          });

        setClusters(rootNodes);
        setStructureAssignments(assignmentSummaries);
        deadLinkChromeIdsRef.current = [];
        setStats({ duplicates: duplicateCount, deadLinks: 0 });
        setHasCachedResults(rootNodes.length > 0);
        setErrorMessage(null);
        if (!silent) {
          setStatus("ready");
        }
      } catch (error) {
        if (isFailedFetchError(error)) {
          console.warn(
            "[RESULTS] Backend unreachable while loading structure.",
          );
          setErrorMessage(BACKEND_UNAVAILABLE_MESSAGE);
        } else if (isAbortError(error)) {
          console.warn(
            `[RESULTS] Structure request timed out after ${STRUCTURE_REQUEST_TIMEOUT_MS}ms.`,
          );
          setErrorMessage(
            "Loading organized bookmark structure timed out. Try again.",
          );
        } else {
          console.error("Fetch results error", error);
          setErrorMessage("Failed to load organized bookmark structure.");
        }
        if (!silent) {
          setStatus("error");
        } else {
          setHasCachedResults(false);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [
      availableRootsRef,
      bookmarkPreferredRootMapRef,
      bookmarkRootMapRef,
      deadLinkChromeIdsRef,
      ensureCurrentBookmarkTreeSnapshot,
      originalTreeRef,
      overflowBookmarksRef,
      setClusters,
      setErrorMessage,
      setHasCachedResults,
      setStats,
      setStatus,
      setStructureAssignments,
      structureClient,
      userId,
    ],
  );

  return { fetchResults };
};
