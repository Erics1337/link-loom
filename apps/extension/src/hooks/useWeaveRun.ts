import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { BookmarkNode } from "../components/BookmarkTree";
import { ClusteringSettings } from "../lib/clusteringSettings";
import { BookmarkStats, normalizeBookmarkUrl } from "../lib/bookmarkStructure";
import {
  StatusResponse,
  StructureClient,
  WeavingProgress,
} from "../lib/structureClient";
import {
  clearPersistedOverflowBookmarks,
  collectScannedBookmarks,
  persistOverflowBookmarks,
  savePreOrganizeBackup,
  ScannedBookmark,
} from "../lib/processingSession";
import {
  AppStatus,
  DEFAULT_FREE_TIER_LIMIT,
  getWeavingIngestErrorMessage,
  isFailedFetchError,
  LimitExceededInfo,
  ProcessingIdentity,
  WeavingPhase,
} from "./useBookmarkWeaverTypes";

const isCompletedPipeline = (status?: string | null) => status === "completed";
const isFailedPipeline = (status?: string | null) => status === "failed";
const isCancelledPipeline = (status?: string | null) => status === "cancelled";

export const getTerminalWeavingAction = (
  data: Pick<StatusResponse, "isDone" | "pipelineStatus">,
) => {
  if (!data.isDone) return null;
  if (data.pipelineStatus == null) return "fetch-results";
  if (isCompletedPipeline(data.pipelineStatus)) return "fetch-results";
  if (isFailedPipeline(data.pipelineStatus)) return "show-error";
  if (isCancelledPipeline(data.pipelineStatus)) return "idle";
  return null;
};

export const shouldHydrateWeaving = (
  data: Pick<StatusResponse, "isDone" | "pending" | "total">,
) => !data.isDone && (data.pending > 0 || data.total > 0);

export const shouldTriggerClusteringRecovery = (
  data: Pick<
    StatusResponse,
    | "isDone"
    | "total"
    | "pending"
    | "isIngesting"
    | "isClusteringActive"
    | "clusters"
    | "remainingToAssign"
  >,
  recoveryAlreadyTriggered: boolean,
) =>
  !recoveryAlreadyTriggered &&
  !data.isDone &&
  data.total > 0 &&
  data.pending === 0 &&
  !data.isIngesting &&
  !data.isClusteringActive &&
  (data.clusters === 0 || (data.remainingToAssign ?? 0) > 0);

type EnsureAnonymousSession = () => Promise<{
  user: { id: string; email?: string | null; isAnonymous?: boolean };
  accessToken: string;
}>;

type UseWeaveRunArgs = {
  accountUserId?: string | null;
  authAccessToken?: string | null;
  ensureAnonymousSession?: EnsureAnonymousSession;
  userId: string;
  isPremium: boolean;
  status: AppStatus;
  limitExceededInfo: LimitExceededInfo | null;
  effectiveClusteringSettings: ClusteringSettings;
  structureClient: StructureClient;
  authAccessTokenRef: MutableRefObject<string | null>;
  pendingBookmarksRef: MutableRefObject<ScannedBookmark[]>;
  overflowBookmarksRef: MutableRefObject<ScannedBookmark[]>;
  clusterRecoveryTriggered: MutableRefObject<boolean>;
  loadCurrentBookmarkTreeSnapshot: () => Promise<any[]>;
  resetRunState: () => void;
  fetchResults: (idOverride?: string, silent?: boolean) => Promise<void>;
  setStatus: Dispatch<SetStateAction<AppStatus>>;
  setHasCachedResults: Dispatch<SetStateAction<boolean>>;
  setWeavingPhase: Dispatch<SetStateAction<WeavingPhase>>;
  setLimitExceededInfo: Dispatch<SetStateAction<LimitExceededInfo | null>>;
  setProgress: Dispatch<SetStateAction<WeavingProgress>>;
  setUserId: Dispatch<SetStateAction<string>>;
  setClusters: Dispatch<SetStateAction<BookmarkNode[]>>;
  setStats: Dispatch<SetStateAction<BookmarkStats>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setIsPremium: Dispatch<SetStateAction<boolean>>;
};

export const useWeaveRun = ({
  accountUserId,
  authAccessToken,
  ensureAnonymousSession,
  userId,
  isPremium,
  status,
  limitExceededInfo,
  effectiveClusteringSettings,
  structureClient,
  authAccessTokenRef,
  pendingBookmarksRef,
  overflowBookmarksRef,
  clusterRecoveryTriggered,
  loadCurrentBookmarkTreeSnapshot,
  resetRunState,
  fetchResults,
  setStatus,
  setHasCachedResults,
  setWeavingPhase,
  setLimitExceededInfo,
  setProgress,
  setUserId,
  setClusters,
  setStats,
  setErrorMessage,
  setIsPremium,
}: UseWeaveRunArgs) => {
  const [isCheckingInitialStatus, setIsCheckingInitialStatus] = useState(
    Boolean(accountUserId),
  );
  const [checkedInitialStatusUserId, setCheckedInitialStatusUserId] = useState<
    string | null
  >(null);

  const ensureProcessingIdentity =
    useCallback(async (): Promise<ProcessingIdentity> => {
      if (accountUserId && authAccessToken) {
        setUserId(accountUserId);
        return { userId: accountUserId, accessToken: authAccessToken };
      }
      if (userId && authAccessToken) {
        return { userId, accessToken: authAccessToken };
      }
      if (!ensureAnonymousSession) {
        if (userId) return { userId, accessToken: "" };
        throw new Error(
          "Start a Link Loom session before organizing bookmarks.",
        );
      }

      const session = await ensureAnonymousSession();
      authAccessTokenRef.current = session.accessToken;
      setUserId(session.user.id);
      return { userId: session.user.id, accessToken: session.accessToken };
    }, [
      accountUserId,
      authAccessToken,
      authAccessTokenRef,
      ensureAnonymousSession,
      setUserId,
      userId,
    ]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const resolvedUserId = accountUserId || "";
      if (cancelled) return;
      if (!resolvedUserId) {
        setCheckedInitialStatusUserId(null);
        setIsCheckingInitialStatus(false);
        return;
      }

      setIsCheckingInitialStatus(true);
      setUserId(resolvedUserId);

      try {
        const data = await structureClient.getStatus(resolvedUserId);
        if (cancelled) return;

        if (data.isPremium) setIsPremium(true);
        else setIsPremium(false);

        if (shouldHydrateWeaving(data)) {
          setStatus("weaving");
          setProgress({
            pending: data.pending,
            pendingRaw: data.pendingRaw ?? data.pending ?? 0,
            enriched: data.enriched ?? 0,
            embedded: data.embedded ?? 0,
            errored: data.errored ?? 0,
            processing: data.processing ?? data.pending ?? 0,
            remainingToAssign: data.remainingToAssign ?? 0,
            clusters: data.clusters,
            assigned: data.assigned || 0,
            total: data.total,
            isIngesting: Boolean(data.isIngesting),
            ingestProcessed: data.ingestProcessed || 0,
            ingestTotal: data.ingestTotal || data.total || 0,
            isClusteringActive: Boolean(data.isClusteringActive),
          });
        } else {
          const terminalAction = getTerminalWeavingAction(data);
          if (terminalAction === "fetch-results") {
            setHasCachedResults(true);
            await fetchResults(resolvedUserId, true);
          } else if (terminalAction === "show-error") {
            setErrorMessage(
              "Link Loom could not finish organizing this run. Start again to retry.",
            );
            setStatus("error");
          } else if (terminalAction === "idle") {
            setStatus("idle");
          }
        }
      } catch (e) {
        if (isFailedFetchError(e)) {
          console.warn(
            "[STATUS] Backend not reachable during initial status check.",
          );
          return;
        }
        console.error("Failed to check initial status", e);
      } finally {
        if (!cancelled) {
          setCheckedInitialStatusUserId(resolvedUserId);
          setIsCheckingInitialStatus(false);
        }
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [
    accountUserId,
    fetchResults,
    setErrorMessage,
    setHasCachedResults,
    setIsPremium,
    setProgress,
    setStatus,
    setUserId,
    structureClient,
  ]);

  useEffect(() => {
    if (status !== "weaving" || !userId) return;

    if (typeof chrome === "undefined" || !chrome.bookmarks) {
      return;
    }

    let pollingInFlight = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const poll = async () => {
      if (pollingInFlight) return;
      pollingInFlight = true;

      try {
        const data = await structureClient.getStatus(userId);
        if (stopped) return;

        if (data.isPremium) setIsPremium(true);

        setProgress((prev) => ({
          ...prev,
          pending: data.pending,
          pendingRaw: data.pendingRaw ?? data.pending ?? 0,
          enriched: data.enriched ?? 0,
          embedded: data.embedded ?? 0,
          errored: data.errored ?? 0,
          processing: data.processing ?? data.pending ?? 0,
          remainingToAssign: data.remainingToAssign ?? 0,
          clusters: data.clusters,
          assigned: data.assigned || 0,
          total: data.total || prev.total,
          isIngesting: Boolean(data.isIngesting),
          ingestProcessed: data.ingestProcessed || 0,
          ingestTotal: data.ingestTotal || data.total || prev.total,
          isClusteringActive: Boolean(data.isClusteringActive),
        }));

        const terminalAction = getTerminalWeavingAction(data);
        if (terminalAction) {
          stopped = true;
          if (intervalId) clearInterval(intervalId);
          if (terminalAction === "fetch-results") {
            await fetchResults(userId);
          } else if (terminalAction === "show-error") {
            setErrorMessage(
              "Link Loom could not finish organizing this run. Start again to retry.",
            );
            setStatus("error");
          } else if (terminalAction === "idle") {
            setStatus("idle");
          }
          return;
        }

        if (
          shouldTriggerClusteringRecovery(
            data,
            clusterRecoveryTriggered.current,
          )
        ) {
          clusterRecoveryTriggered.current = true;
          structureClient
            .triggerClustering(userId, effectiveClusteringSettings)
            .catch((err) =>
              console.error(
                "[WEAVING] Failed to trigger recovery clustering",
                err,
              ),
            );
        }
      } catch (e) {
        if (isFailedFetchError(e)) {
          console.warn(
            "[STATUS] Polling skipped because backend is unavailable.",
          );
          return;
        }
        console.error("Polling error", e);
      } finally {
        pollingInFlight = false;
      }
    };

    // Poll every 2s while runs are usually short; after a minute the run
    // is clearly a long one, so back off to 5s to cut status-query load.
    const POLL_INTERVAL_MS = 2000;
    const SLOW_POLL_INTERVAL_MS = 5000;
    const SLOW_POLL_AFTER_MS = 60_000;

    intervalId = setInterval(poll, POLL_INTERVAL_MS);

    const slowdownTimeoutId = setTimeout(() => {
      if (stopped) return;
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(poll, SLOW_POLL_INTERVAL_MS);
    }, SLOW_POLL_AFTER_MS);

    return () => {
      stopped = true;
      clearTimeout(slowdownTimeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [
    clusterRecoveryTriggered,
    effectiveClusteringSettings,
    fetchResults,
    setIsPremium,
    setProgress,
    setErrorMessage,
    setStatus,
    status,
    structureClient,
    userId,
  ]);

  const startWeaving = useCallback(async () => {
    let processingIdentity: ProcessingIdentity;
    try {
      processingIdentity = await ensureProcessingIdentity();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to start Link Loom session.",
      );
      setStatus("error");
      return;
    }

    setWeavingPhase(null);
    setClusters([]);
    setHasCachedResults(false);
    resetRunState();

    if (processingIdentity.userId) {
      await clearPersistedOverflowBookmarks(processingIdentity.userId);
    }

    if (typeof chrome === "undefined" || !chrome.bookmarks) {
      console.log("Running in mock mode");
      setStatus("weaving");
      setWeavingPhase("ingest");
      setTimeout(() => {
        setProgress({
          pending: 50,
          pendingRaw: 40,
          enriched: 10,
          embedded: 50,
          errored: 0,
          processing: 50,
          remainingToAssign: 80,
          clusters: 5,
          assigned: 20,
          total: 100,
          isIngesting: false,
          ingestProcessed: 100,
          ingestTotal: 100,
          isClusteringActive: true,
        });
      }, 1000);
      setTimeout(() => {
        setClusters([
          {
            id: "1",
            title: "Development",
            children: [
              {
                id: "1-1",
                title: "AI Research",
                children: [
                  {
                    id: "1-1-1",
                    title: "OpenAI Platform",
                    url: "https://platform.openai.com",
                  },
                  {
                    id: "1-1-2",
                    title: "LangChain",
                    url: "https://python.langchain.com",
                  },
                ],
              },
              {
                id: "1-2",
                title: "Frontend",
                children: [
                  {
                    id: "1-2-1",
                    title: "React",
                    url: "https://react.dev",
                  },
                ],
              },
            ],
          },
          {
            id: "2",
            title: "Inspiration",
            children: [
              {
                id: "2-1",
                title: "Design Blog",
                url: "https://example.com/design",
              },
            ],
          },
        ]);
        setStats({ duplicates: 7, deadLinks: 0 });
        setStatus("ready");
      }, 3000);
      return;
    }

    try {
      const tree = await loadCurrentBookmarkTreeSnapshot();
      const bookmarks = collectScannedBookmarks(tree);
      const totalBookmarks = bookmarks.length;

      await savePreOrganizeBackup(tree);
      console.log("[WEAVING] Safety Backup saved to chrome.storage.local");

      if (!isPremium && totalBookmarks > DEFAULT_FREE_TIER_LIMIT) {
        pendingBookmarksRef.current = bookmarks;
        setLimitExceededInfo({
          total: totalBookmarks,
          limit: DEFAULT_FREE_TIER_LIMIT,
        });
        setStats({ duplicates: 0, deadLinks: 0 });
        setWeavingPhase(null);
        setStatus("limit_exceeded");
        return;
      }

      setStatus("weaving");
      setWeavingPhase("ingest");
      setProgress((prev) => ({
        ...prev,
        total: totalBookmarks,
        pending: totalBookmarks,
        pendingRaw: totalBookmarks,
        enriched: 0,
        embedded: 0,
        errored: 0,
        processing: totalBookmarks,
        remainingToAssign: totalBookmarks,
        isIngesting: true,
        ingestProcessed: 0,
        ingestTotal: totalBookmarks,
        isClusteringActive: false,
      }));

      const urlCounts = new Map<string, number>();
      bookmarks.forEach((bookmark) => {
        const key = normalizeBookmarkUrl(bookmark.url);
        urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
      });
      const duplicateCount = Array.from(urlCounts.values()).reduce(
        (sum, count) => sum + Math.max(0, count - 1),
        0,
      );
      setStats({ duplicates: duplicateCount, deadLinks: 0 });

      const response = await structureClient.ingest({
        bookmarks,
        clusteringSettings: effectiveClusteringSettings,
        accessToken: processingIdentity.accessToken,
      });

      if (response.status === 402) {
        const errorData = await response.json();
        console.warn("[WEAVING] Limit exceeded:", errorData);
        pendingBookmarksRef.current = bookmarks;
        setLimitExceededInfo({
          total: bookmarks.length,
          limit: errorData.limit ?? 500,
        });
        setStats({ duplicates: 0, deadLinks: 0 });
        setWeavingPhase(null);
        setStatus("limit_exceeded");
        return;
      }

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }
    } catch (error) {
      const message = getWeavingIngestErrorMessage(error);
      if (isFailedFetchError(error)) {
        console.warn("[WEAVING] Backend unreachable while starting weave.");
      } else {
        console.error("Weaving error", error);
      }
      setErrorMessage(message);
      setStatus("error");
    }
  }, [
    effectiveClusteringSettings,
    ensureProcessingIdentity,
    isPremium,
    loadCurrentBookmarkTreeSnapshot,
    pendingBookmarksRef,
    resetRunState,
    setClusters,
    setErrorMessage,
    setHasCachedResults,
    setLimitExceededInfo,
    setProgress,
    setStats,
    setStatus,
    setWeavingPhase,
    structureClient,
  ]);

  const continueWithLimitedBookmarks = useCallback(async () => {
    const limit = limitExceededInfo?.limit ?? 500;
    const allBookmarks = pendingBookmarksRef.current;
    const slicedBookmarks = allBookmarks.slice(0, limit);
    const overflowBookmarks = allBookmarks.slice(limit);
    pendingBookmarksRef.current = slicedBookmarks;
    setLimitExceededInfo(null);
    setStatus("weaving");
    setWeavingPhase("ingest");
    setErrorMessage(null);
    setProgress((prev) => ({
      ...prev,
      total: slicedBookmarks.length,
      pending: slicedBookmarks.length,
      pendingRaw: slicedBookmarks.length,
      processing: slicedBookmarks.length,
      remainingToAssign: slicedBookmarks.length,
      isIngesting: true,
      ingestProcessed: 0,
      ingestTotal: slicedBookmarks.length,
    }));

    try {
      const processingIdentity = await ensureProcessingIdentity();
      const response = await structureClient.ingest({
        bookmarks: slicedBookmarks,
        clusteringSettings: effectiveClusteringSettings,
        accessToken: processingIdentity.accessToken,
      });

      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}));
        pendingBookmarksRef.current = slicedBookmarks;
        setLimitExceededInfo({
          total: slicedBookmarks.length,
          limit: errorData.limit ?? 500,
        });
        setWeavingPhase(null);
        setStatus("limit_exceeded");
        return;
      }

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      pendingBookmarksRef.current = [];
      overflowBookmarksRef.current = overflowBookmarks;
      if (userId) {
        await persistOverflowBookmarks(userId, overflowBookmarks);
      }
    } catch (error) {
      setErrorMessage(getWeavingIngestErrorMessage(error));
      setStatus("error");
    }
  }, [
    effectiveClusteringSettings,
    ensureProcessingIdentity,
    limitExceededInfo,
    overflowBookmarksRef,
    pendingBookmarksRef,
    setErrorMessage,
    setLimitExceededInfo,
    setProgress,
    setStatus,
    setWeavingPhase,
    structureClient,
    userId,
  ]);

  const cancelWeaving = useCallback(async () => {
    if (!userId) return;
    try {
      await clearPersistedOverflowBookmarks(userId);
      await structureClient.cancel(userId);
    } catch (error) {
      console.error("Cancel error", error);
    } finally {
      setStatus("idle");
      resetRunState();
    }
  }, [resetRunState, setStatus, structureClient, userId]);

  return {
    isCheckingInitialStatus:
      isCheckingInitialStatus ||
      Boolean(accountUserId && checkedInitialStatusUserId !== accountUserId),
    startWeaving,
    continueWithLimitedBookmarks,
    cancelWeaving,
    ensureProcessingIdentity,
  };
};
