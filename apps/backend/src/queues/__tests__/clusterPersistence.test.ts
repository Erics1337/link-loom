import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../db";
import {
  assignBookmarksToCluster,
  clearUnpinnedAssignmentsAndPruneClusters,
  createCluster,
  fetchPinnedBookmarkIds,
  fetchUserBookmarkVectorRows,
  MAX_BOOKMARKS,
} from "../clustering/clusterPersistence";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe("clusterPersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("assigns bookmarks to a cluster in fixed-size batches", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as any).mockReturnValue({ insert });
    const log = vi.fn();
    const bookmarkIds = Array.from(
      { length: 1001 },
      (_, index) => `bookmark-${index}`,
    );

    const result = await assignBookmarksToCluster(
      bookmarkIds,
      "cluster-1",
      log,
    );

    expect(result).toEqual({
      success: true,
      total: 1001,
      inserted: 1001,
      failed: 0,
      failedBatches: [],
    });
    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert.mock.calls[0][0]).toHaveLength(500);
    expect(insert.mock.calls[1][0]).toHaveLength(500);
    expect(insert.mock.calls[2][0]).toEqual([
      {
        cluster_id: "cluster-1",
        bookmark_id: "bookmark-1000",
      },
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it("fetches bookmark vector rows in paginated chunks", async () => {
    const firstChunk = Array.from({ length: 1000 }, (_, index) => ({
      id: `bookmark-${index}`,
      shared_links: { vector: [index] },
    }));
    const secondChunk = [
      { id: "bookmark-1000", shared_links: { vector: [1000] } },
    ];
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: firstChunk, error: null })
      .mockResolvedValueOnce({ data: secondChunk, error: null });
    const order = vi.fn(() => ({ range }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    (supabase.from as any).mockReturnValue({ select });
    const log = vi.fn();

    const result = await fetchUserBookmarkVectorRows(
      "user-1",
      async () => false,
      log,
    );

    expect(result).toEqual({
      status: "ok",
      rows: [...firstChunk, ...secondChunk],
    });
    expect(order).toHaveBeenCalledWith("id", { ascending: true });
    expect(range).toHaveBeenCalledTimes(2);
    expect(range.mock.calls[0][0]).toBe(0);
    expect(range.mock.calls[1][0]).toBe(1000);
  });

  it("returns an error when fetched bookmarks exceed MAX_BOOKMARKS", async () => {
    const oversizedChunk = Array.from(
      { length: MAX_BOOKMARKS + 1 },
      (_, index) => ({
        id: `bookmark-${index}`,
        shared_links: { vector: [index] },
      }),
    );
    const range = vi
      .fn()
      .mockResolvedValue({ data: oversizedChunk, error: null });
    const order = vi.fn(() => ({ range }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    (supabase.from as any).mockReturnValue({ select });
    const log = vi.fn();

    const result = await fetchUserBookmarkVectorRows(
      "user-1",
      async () => false,
      log,
    );

    expect(result.status).toBe("error");
    expect(result).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining("too many bookmarks"),
      }),
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(`exceeds limit of ${MAX_BOOKMARKS}`),
    );
  });

  it("logs batch context when an assignment insert fails", async () => {
    const error = { message: "payload too large" };
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error });
    (supabase.from as any).mockReturnValue({ insert });
    const log = vi.fn();
    const bookmarkIds = Array.from(
      { length: 501 },
      (_, index) => `bookmark-${index}`,
    );

    const result = await assignBookmarksToCluster(
      bookmarkIds,
      "cluster-1",
      log,
    );

    expect(result).toEqual({
      success: false,
      total: 501,
      inserted: 500,
      failed: 1,
      failedBatches: [
        {
          from: 500,
          to: 500,
          bookmarkIds: ["bookmark-500"],
          error,
        },
      ],
    });
    expect(log).toHaveBeenCalledWith(
      `Batch insert error for cluster cluster-1, assignments 500-500: ${JSON.stringify(error)}`,
    );
  });

  it("deduplicates bookmark ids before batching inserts", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as any).mockReturnValue({ insert });
    const log = vi.fn();

    const result = await assignBookmarksToCluster(
      ["bookmark-1", "bookmark-1", "bookmark-2"],
      "cluster-1",
      log,
    );

    expect(result).toEqual({
      success: true,
      total: 2,
      inserted: 2,
      failed: 0,
      failedBatches: [],
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toEqual([
      { cluster_id: "cluster-1", bookmark_id: "bookmark-1" },
      { cluster_id: "cluster-1", bookmark_id: "bookmark-2" },
    ]);
  });

  it("persists distance_to_centroid only for bookmarks with a known distance", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as any).mockReturnValue({ insert });
    const log = vi.fn();
    const distanceById = new Map([
      ["bookmark-1", 0.25],
      ["bookmark-2", 0],
    ]);

    const result = await assignBookmarksToCluster(
      ["bookmark-1", "bookmark-2", "bookmark-3"],
      "cluster-1",
      log,
      distanceById,
    );

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith([
      {
        cluster_id: "cluster-1",
        bookmark_id: "bookmark-1",
        distance_to_centroid: 0.25,
      },
      {
        cluster_id: "cluster-1",
        bookmark_id: "bookmark-2",
        distance_to_centroid: 0,
      },
      { cluster_id: "cluster-1", bookmark_id: "bookmark-3" },
    ]);
  });

  it("stores keywords on the cluster, or null when there are none", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: { id: "cluster-1" }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    (supabase.from as any).mockReturnValue({ insert });
    const log = vi.fn();

    await createCluster("user-1", null, "Reading", ["docs", "guides"], log);
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      name: "Reading",
      parent_id: null,
      keywords: ["docs", "guides"],
    });

    await createCluster("user-1", null, "General", [], log);
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      name: "General",
      parent_id: null,
      keywords: null,
    });
  });

  it("fetches pinned bookmark ids in paginated chunks", async () => {
    const firstChunk = Array.from({ length: 1000 }, (_, index) => ({
      bookmark_id: `bookmark-${index}`,
    }));
    const secondChunk = [{ bookmark_id: "bookmark-1000" }];
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: firstChunk, error: null })
      .mockResolvedValueOnce({ data: secondChunk, error: null });
    const eq2 = vi.fn(() => ({ range }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    (supabase.from as any).mockReturnValue({ select });
    const log = vi.fn();

    const result = await fetchPinnedBookmarkIds("user-1", log);

    expect(result.size).toBe(1001);
    expect(result.has("bookmark-0")).toBe(true);
    expect(result.has("bookmark-1000")).toBe(true);
    expect(eq1).toHaveBeenCalledWith("is_pinned", true);
    expect(eq2).toHaveBeenCalledWith("bookmarks.user_id", "user-1");
  });

  it("throws and logs when the pinned bookmark lookup fails", async () => {
    const range = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "lookup failed" },
    });
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn(() => ({ range })) })),
    }));
    (supabase.from as any).mockReturnValue({ select });
    const log = vi.fn();

    await expect(fetchPinnedBookmarkIds("user-1", log)).rejects.toEqual({
      message: "lookup failed",
    });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Error fetching pinned bookmark ids"),
    );
  });

  it("clears unpinned assignments via the scoped RPC and reports success", async () => {
    (supabase.rpc as any).mockResolvedValue({ error: null });
    const log = vi.fn();

    const result = await clearUnpinnedAssignmentsAndPruneClusters(
      "user-1",
      log,
    );

    expect(result).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "clear_unpinned_cluster_assignments",
      { p_user_id: "user-1" },
    );
    expect(log).not.toHaveBeenCalled();
  });

  it("reports failure and logs when the clear-unpinned RPC errors", async () => {
    (supabase.rpc as any).mockResolvedValue({ error: { message: "boom" } });
    const log = vi.fn();

    const result = await clearUnpinnedAssignmentsAndPruneClusters(
      "user-1",
      log,
    );

    expect(result).toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Error clearing unpinned cluster assignments"),
    );
  });
});
