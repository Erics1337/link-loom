import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueManualBookmark } from "../manualBookmark";
import { supabase } from "../../db";
import { queues } from "../queue";
import { beginUserPipelineRun, failPipelineRun } from "../cancellation";
import { recordPipelineRunStarted } from "../pipelineCoordinator";

vi.mock("../../db", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

vi.mock("../queue", () => ({
  queues: {
    ingest: {
      add: vi.fn(),
    },
  },
}));

vi.mock("../cancellation", () => ({
  beginUserPipelineRun: vi.fn(),
  failPipelineRun: vi.fn(),
}));

vi.mock("../pipelineCoordinator", () => ({
  recordPipelineRunStarted: vi.fn(),
}));

describe("queueManualBookmark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (beginUserPipelineRun as any).mockResolvedValue({
      id: "run-7",
      generation: 7,
    });
    (failPipelineRun as any).mockResolvedValue(undefined);
    (recordPipelineRunStarted as any).mockResolvedValue(undefined);
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });
  });

  it("rejects unsupported URL protocols before queueing work", async () => {
    const result = await queueManualBookmark({
      userId: "user-1",
      rawUrl: "file:///etc/passwd",
      freeTierLimit: 500,
      isPremium: true,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      payload: { error: "Only http and https URLs can be saved." },
    });
    expect(queues.ingest.add).not.toHaveBeenCalled();
    expect(beginUserPipelineRun).not.toHaveBeenCalled();
  });

  it("queues valid manual links through ingest after clearing stale clusters", async () => {
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
    };
    const clusterChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === "bookmarks") return countChain;
      if (table === "clusters") return clusterChain;
      return {};
    });

    const result = await queueManualBookmark({
      userId: "user-1",
      rawUrl: "https://example.com/docs",
      title: "Example Docs",
      freeTierLimit: 500,
      isPremium: false,
    });

    expect(result.ok).toBe(true);
    expect(beginUserPipelineRun).toHaveBeenCalledWith("user-1");
    expect(clusterChain.delete).toHaveBeenCalled();
    expect(queues.ingest.add).toHaveBeenCalledWith(
      "ingest",
      expect.objectContaining({
        userId: "user-1",
        pipelineRunId: "run-7",
        jobGeneration: 7,
        bookmarks: [
          expect.objectContaining({
            url: "https://example.com/docs",
            title: "Example Docs",
          }),
        ],
      }),
      { jobId: "ingest-user-1-manual-run-run-7" },
    );
  });

  it("marks the pipeline run failed when manual bookmark enqueueing fails", async () => {
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
    };
    const clusterChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const enqueueError = new Error("queue unavailable");

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === "bookmarks") return countChain;
      if (table === "clusters") return clusterChain;
      return {};
    });
    (queues.ingest.add as any).mockRejectedValueOnce(enqueueError);

    const result = await queueManualBookmark({
      userId: "user-1",
      rawUrl: "https://example.com/docs",
      title: "Example Docs",
      freeTierLimit: 500,
      isPremium: false,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 500,
      payload: { error: "Failed to queue bookmark" },
    });
    expect(failPipelineRun).toHaveBeenCalledWith("run-7", {
      reason: "enqueue_failed",
      generation: 7,
      error: "queue unavailable",
    });
  });
});
