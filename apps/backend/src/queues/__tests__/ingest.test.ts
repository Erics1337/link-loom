import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestProcessor } from "../ingest";
import { supabase } from "../../db";
import { queues } from "../../lib/queue";
import { isUserCancelled } from "../../lib/cancellation";
import {
  notifyPipelineBookmarkTerminal,
  recordPipelineIngestCompleted,
  recordPipelineIngestTotal,
} from "../../lib/pipelineCoordinator";
import { QueueJob } from "../../lib/queue";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("../../lib/queue", () => ({
  queues: {
    enrichment: {
      add: vi.fn(),
    },
    clustering: {
      add: vi.fn(),
    },
  },
}));

vi.mock("../../lib/cancellation", () => ({
  isUserCancelled: vi.fn(),
}));

vi.mock("../../lib/pipelineCoordinator", () => ({
  notifyPipelineBookmarkTerminal: vi.fn(),
  recordPipelineIngestCompleted: vi.fn(),
  recordPipelineIngestTotal: vi.fn(),
  recordPipelineUntrackedError: vi.fn(),
}));

// Mimics a supabase-js PostgrestFilterBuilder: every intermediate method
// returns the same chainable object, and the object itself is awaitable.
const createQueryBuilder = (result: any = { data: [], error: null }) => {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    not: vi.fn(() => builder),
    in: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
};

describe("Ingest Worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isUserCancelled as any).mockReturnValue(false);
  });

  const createMockJob = (data: any) =>
    ({
      data,
      updateProgress: vi.fn(),
    }) as unknown as QueueJob<any>;

  const createBatchedTableMocks = ({
    cachedHashes = new Set<string>(),
    existingBookmarks = [] as any[],
    knownClusterFolders = [] as any[],
    clusterAssignmentsInsertResult = { error: null } as any,
    clusterAssignmentsDeleteOtherResult = { error: null } as any,
    clusterAssignmentsDeleteExactResult = { error: null } as any,
  }: {
    cachedHashes?: Set<string>;
    existingBookmarks?: any[];
    knownClusterFolders?: any[];
    clusterAssignmentsInsertResult?: any;
    clusterAssignmentsDeleteOtherResult?: any;
    clusterAssignmentsDeleteExactResult?: any;
  } = {}) => {
    const mockUsersChain = createQueryBuilder({ data: { id: "user-1" } });

    const sharedLinksUpsert = vi.fn().mockResolvedValue({ error: null });
    const sharedLinksIn = vi.fn(async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({
        id,
        vector: cachedHashes.has(id) ? [0.1, 0.2] : null,
      })),
      error: null,
    }));
    const mockSharedLinksChain = {
      upsert: sharedLinksUpsert,
      select: vi.fn().mockReturnThis(),
      in: sharedLinksIn,
    };

    const bookmarksSelect = vi.fn(async () => ({
      data: bookmarksUpsert.mock.calls[
        bookmarksUpsert.mock.calls.length - 1
      ][0].map((row: any, index: number) => ({
        id: `bm-${index + 1}`,
        chrome_id: row.chrome_id,
        url: row.url,
      })),
      error: null,
    }));
    const bookmarksUpsert = vi
      .fn()
      .mockReturnValue({ select: bookmarksSelect });
    const bookmarksUpdateIn = vi.fn().mockResolvedValue({ error: null });
    const bookmarksUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const bookmarksDeleteIn = vi.fn().mockResolvedValue({ error: null });
    const mockBookmarksChain = {
      upsert: bookmarksUpsert,
      update: vi.fn((updates: any) => ({
        in: bookmarksUpdateIn,
        eq: vi.fn(() => bookmarksUpdateEq(updates)),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({ in: bookmarksDeleteIn })),
      })),
      // fetchExistingBookmarksByChromeId chain
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn().mockResolvedValue({
              data: existingBookmarks,
              error: null,
            }),
          })),
        })),
      })),
    };

    const clusterAssignmentsDeleteOther = vi
      .fn()
      .mockResolvedValue(clusterAssignmentsDeleteOtherResult);
    const clusterAssignmentsDeleteExact = vi
      .fn()
      .mockResolvedValue(clusterAssignmentsDeleteExactResult);
    const clusterAssignmentsDeleteEq = vi.fn(() => ({
      neq: clusterAssignmentsDeleteOther,
      eq: clusterAssignmentsDeleteExact,
    }));
    const clusterAssignmentsInsert = vi
      .fn()
      .mockResolvedValue(clusterAssignmentsInsertResult);
    const mockClusterAssignmentsChain = {
      delete: vi.fn(() => ({
        eq: clusterAssignmentsDeleteEq,
        in: clusterAssignmentsDeleteOther,
      })),
      insert: clusterAssignmentsInsert,
    };

    const clustersInsert = vi.fn().mockResolvedValue({
      data: { id: "minted-cluster" },
      error: null,
    });
    const mockClustersChain = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          not: vi.fn().mockResolvedValue({
            data: knownClusterFolders,
            error: null,
          }),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: clustersInsert })),
      })),
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === "users") return mockUsersChain;
      if (table === "shared_links") return mockSharedLinksChain;
      if (table === "bookmarks") return mockBookmarksChain;
      if (table === "cluster_assignments") return mockClusterAssignmentsChain;
      if (table === "clusters") return mockClustersChain;
      return createQueryBuilder();
    });

    return {
      sharedLinksUpsert,
      sharedLinksIn,
      bookmarksUpsert,
      bookmarksUpdateIn,
      bookmarksUpdateEq,
      bookmarksDeleteIn,
      clusterAssignmentsDeleteEq,
      clusterAssignmentsDeleteOther,
      clusterAssignmentsDeleteExact,
      clusterAssignmentsInsert,
      clustersInsert,
    };
  };

  it("should correctly process a cache MISS and enqueue to enrichment", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-9",
      jobGeneration: 9,
      bookmarks: [{ id: "c-1", url: "https://example.com", title: "Example" }],
      clusteringSettings: {
        clusters: 20,
      },
    });

    const mocks = createBatchedTableMocks();

    await ingestProcessor(job);

    // Verify shared link and bookmark upserted in batches
    expect(mocks.sharedLinksUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({ url: "https://example.com" })],
      { onConflict: "id" },
    );
    expect(mocks.bookmarksUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: "user-1",
          chrome_id: "c-1",
          url: "https://example.com",
          pipeline_run_id: "run-9",
        }),
      ],
      { onConflict: "chrome_id,user_id" },
    );

    // Verify enqueue to enrichment
    expect(queues.enrichment.add).toHaveBeenCalledWith(
      "enrich",
      expect.objectContaining({
        userId: "user-1",
        pipelineRunId: "run-9",
        jobGeneration: 9,
        bookmarkId: "bm-1",
        url: "https://example.com",
      }),
      { jobId: "enrich-user-1-run-run-9-bm-1" },
    );

    expect(queues.clustering.add).not.toHaveBeenCalled();
    expect(recordPipelineIngestTotal).toHaveBeenCalledWith(
      "user-1",
      9,
      "run-9",
      1,
    );
    expect(recordPipelineIngestCompleted).toHaveBeenCalledWith(
      "user-1",
      9,
      "run-9",
      expect.any(Object),
    );
    expect(isUserCancelled).toHaveBeenCalledWith("user-1", 9, "run-9");
  });

  it("should preserve generation zero in enrichment job ids", async () => {
    const job = createMockJob({
      userId: "user-1",
      jobGeneration: 0,
      bookmarks: [{ id: "c-1", url: "https://example.com", title: "Example" }],
    });

    createBatchedTableMocks();

    await ingestProcessor(job);

    expect(queues.enrichment.add).toHaveBeenCalledWith(
      "enrich",
      expect.objectContaining({
        userId: "user-1",
        jobGeneration: 0,
        bookmarkId: "bm-1",
      }),
      { jobId: "enrich-user-1-run-0-bm-1" },
    );
  });

  it("should mark cache HITs embedded in one batch and notify per bookmark", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-9",
      jobGeneration: 9,
      bookmarks: [
        { id: "c-1", url: "https://a.example", title: "A" },
        { id: "c-2", url: "https://b.example", title: "B" },
      ],
    });

    const mocks = createBatchedTableMocks({
      cachedHashes: new Set(
        // Every hash counts as cached.
        [],
      ),
    });
    mocks.sharedLinksIn.mockImplementation(
      async (_column: string, ids: string[]) => ({
        data: ids.map((id) => ({ id, vector: [0.1, 0.2] })),
        error: null,
      }),
    );

    await ingestProcessor(job);

    expect(mocks.bookmarksUpdateIn).toHaveBeenCalledWith("id", [
      "bm-1",
      "bm-2",
    ]);
    expect(notifyPipelineBookmarkTerminal).toHaveBeenCalledTimes(2);
    expect(queues.enrichment.add).not.toHaveBeenCalled();
    expect(recordPipelineIngestCompleted).toHaveBeenCalledWith(
      "user-1",
      9,
      "run-9",
      expect.any(Object),
    );
  });

  it("should stop processing if cancelled mid-ingest", async () => {
    (isUserCancelled as any)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true); // cancelled on first loop iteration

    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-10",
      jobGeneration: 10,
      bookmarks: [{ id: "c-1", url: "https://example.com", title: "Example" }],
    });

    createBatchedTableMocks();

    await ingestProcessor(job);

    expect(queues.enrichment.add).not.toHaveBeenCalled();
    expect(queues.clustering.add).not.toHaveBeenCalled();
    expect(isUserCancelled).toHaveBeenCalledWith("user-1", 10, "run-10");
  });

  it("should skip an unchanged bookmark entirely (no upsert, no enrichment)", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-11",
      jobGeneration: 11,
      bookmarks: [
        {
          id: "c-1",
          url: "https://example.com",
          title: "Example",
          parentId: "folder-1",
          parentTitle: "Dev",
        },
      ],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing",
          chrome_id: "c-1",
          url: "https://example.com",
          title: "Example",
          chrome_parent_id: "folder-1",
        },
      ],
    });

    await ingestProcessor(job);

    expect(mocks.bookmarksUpsert).not.toHaveBeenCalled();
    expect(mocks.sharedLinksUpsert).not.toHaveBeenCalled();
    expect(queues.enrichment.add).not.toHaveBeenCalled();
    expect(recordPipelineIngestTotal).toHaveBeenCalledWith(
      "user-1",
      11,
      "run-11",
      0,
    );
    expect(recordPipelineIngestCompleted).toHaveBeenCalledWith(
      "user-1",
      11,
      "run-11",
      expect.any(Object),
    );
  });

  it("should update title/folder for a metadata-only change without re-embedding", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-12",
      jobGeneration: 12,
      bookmarks: [
        {
          id: "c-1",
          url: "https://example.com",
          title: "New Title",
          parentId: "folder-1",
        },
      ],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing",
          chrome_id: "c-1",
          url: "https://example.com",
          title: "Old Title",
          chrome_parent_id: "folder-1",
        },
      ],
    });

    await ingestProcessor(job);

    expect(mocks.bookmarksUpdateEq).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Title" }),
    );
    expect(mocks.bookmarksUpsert).not.toHaveBeenCalled();
    expect(queues.enrichment.add).not.toHaveBeenCalled();
  });

  it("should pin a bookmark moved into a recognized cluster folder", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-13",
      jobGeneration: 13,
      bookmarks: [
        {
          id: "c-1",
          url: "https://example.com",
          title: "Example",
          parentId: "folder-known",
        },
      ],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing",
          chrome_id: "c-1",
          url: "https://example.com",
          title: "Example",
          chrome_parent_id: "folder-old",
        },
      ],
      knownClusterFolders: [
        { id: "cluster-known", chrome_folder_id: "folder-known" },
      ],
    });

    await ingestProcessor(job);

    expect(mocks.clusterAssignmentsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster_id: "cluster-known",
        bookmark_id: "bm-existing",
        is_pinned: true,
      }),
    );
  });

  it("should leave existing assignments untouched when pin insert fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-13b",
      jobGeneration: 13,
      bookmarks: [
        {
          id: "c-1",
          url: "https://example.com",
          title: "Example",
          parentId: "folder-known",
        },
      ],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing",
          chrome_id: "c-1",
          url: "https://example.com",
          title: "Example",
          chrome_parent_id: "folder-old",
        },
      ],
      knownClusterFolders: [
        { id: "cluster-known", chrome_folder_id: "folder-known" },
      ],
      clusterAssignmentsInsertResult: {
        error: new Error("insert failed"),
      },
    });

    await ingestProcessor(job);

    expect(mocks.clusterAssignmentsInsert).toHaveBeenCalled();
    expect(mocks.clusterAssignmentsDeleteEq).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("should roll back a new pin when replacing prior assignments fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-13c",
      jobGeneration: 13,
      bookmarks: [
        {
          id: "c-1",
          url: "https://example.com",
          title: "Example",
          parentId: "folder-known",
        },
      ],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing",
          chrome_id: "c-1",
          url: "https://example.com",
          title: "Example",
          chrome_parent_id: "folder-old",
        },
      ],
      knownClusterFolders: [
        { id: "cluster-known", chrome_folder_id: "folder-known" },
      ],
      clusterAssignmentsDeleteOtherResult: {
        error: new Error("delete failed"),
      },
    });

    await ingestProcessor(job);

    expect(mocks.clusterAssignmentsInsert).toHaveBeenCalled();
    expect(mocks.clusterAssignmentsDeleteOther).toHaveBeenCalledWith(
      "cluster_id",
      "cluster-known",
    );
    expect(mocks.clusterAssignmentsDeleteExact).toHaveBeenCalledWith(
      "cluster_id",
      "cluster-known",
    );
    consoleError.mockRestore();
  });

  it("should mint a cluster and pin a bookmark moved into an unrecognized folder", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-14",
      jobGeneration: 14,
      bookmarks: [
        {
          id: "c-1",
          url: "https://example.com",
          title: "Example",
          parentId: "folder-new",
          parentTitle: "My Stuff",
        },
      ],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing",
          chrome_id: "c-1",
          url: "https://example.com",
          title: "Example",
          chrome_parent_id: "folder-old",
        },
      ],
    });

    await ingestProcessor(job);

    expect(mocks.clustersInsert).toHaveBeenCalled();
    expect(mocks.clusterAssignmentsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster_id: "minted-cluster",
        bookmark_id: "bm-existing",
        is_pinned: true,
      }),
    );
  });

  it("should reuse an in-flight minted cluster for concurrent moves into the same folder", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-14b",
      jobGeneration: 14,
      bookmarks: [
        {
          id: "c-1",
          url: "https://a.example",
          title: "A",
          parentId: "folder-new",
          parentTitle: "My Stuff",
        },
        {
          id: "c-2",
          url: "https://b.example",
          title: "B",
          parentId: "folder-new",
          parentTitle: "My Stuff",
        },
      ],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing-1",
          chrome_id: "c-1",
          url: "https://a.example",
          title: "A",
          chrome_parent_id: "folder-old",
        },
        {
          id: "bm-existing-2",
          chrome_id: "c-2",
          url: "https://b.example",
          title: "B",
          chrome_parent_id: "folder-old",
        },
      ],
    });

    await ingestProcessor(job);

    expect(mocks.clustersInsert).toHaveBeenCalledTimes(1);
    expect(mocks.clusterAssignmentsInsert).toHaveBeenCalledTimes(2);
    expect(mocks.clusterAssignmentsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster_id: "minted-cluster",
        bookmark_id: "bm-existing-1",
        is_pinned: true,
      }),
    );
    expect(mocks.clusterAssignmentsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster_id: "minted-cluster",
        bookmark_id: "bm-existing-2",
        is_pinned: true,
      }),
    );
  });

  it("should hard-delete a bookmark missing from the fresh scan", async () => {
    const job = createMockJob({
      userId: "user-1",
      pipelineRunId: "run-15",
      jobGeneration: 15,
      bookmarks: [],
    });

    const mocks = createBatchedTableMocks({
      existingBookmarks: [
        {
          id: "bm-existing",
          chrome_id: "c-removed",
          url: "https://gone.example",
          title: "Gone",
          chrome_parent_id: null,
        },
      ],
    });

    await ingestProcessor(job);

    expect(mocks.bookmarksDeleteIn).toHaveBeenCalledWith("chrome_id", [
      "c-removed",
    ]);
  });
});
