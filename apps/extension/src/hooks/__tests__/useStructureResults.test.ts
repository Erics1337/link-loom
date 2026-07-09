import { describe, expect, it, vi, beforeEach } from "vitest";
import { useStructureResults } from "../useStructureResults";
import { StructureClient } from "../../lib/structureClient";
import { BookmarkRootTitle } from "../../lib/bookmarkImport";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: (fn: any) => fn,
  };
});

describe("useStructureResults error state clearing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("clears any previously stored fetch error when fetchResults successfully refreshes data", async () => {
    const setClusters = vi.fn();
    const setStructureAssignments = vi.fn();
    const setStats = vi.fn();
    const setHasCachedResults = vi.fn();
    const setStatus = vi.fn();
    const setErrorMessage = vi.fn();
    const ensureCurrentBookmarkTreeSnapshot = vi
      .fn()
      .mockResolvedValue(undefined);

    const overflowBookmarksRef = { current: [] };
    const availableRootsRef = {
      current: ["Bookmarks Bar" as BookmarkRootTitle],
    };
    const bookmarkRootMapRef = { current: {} };
    const bookmarkPreferredRootMapRef = { current: {} };
    const originalTreeRef = { current: [] };
    const deadLinkChromeIdsRef = { current: [] };

    const structureClient = new StructureClient({
      backendUrl: "https://backend.example",
      buildAuthHeaders: () => ({}),
      getAuthHeaders: () => ({}),
    });

    const mockResponse = {
      ok: true,
      json: async () => ({
        clusters: [],
        assignments: [],
      }),
    };

    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal("fetch", fetchMock);

    const { fetchResults } = useStructureResults({
      userId: "user-123",
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
    });

    await fetchResults();

    expect(setClusters).toHaveBeenCalled();
    expect(setStructureAssignments).toHaveBeenCalled();
    expect(setErrorMessage).toHaveBeenCalledWith(null);
    expect(setStatus).toHaveBeenCalledWith("ready");
  });
});
