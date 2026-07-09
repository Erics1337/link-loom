import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../db";
import { isUserCancelled } from "../cancellation";
import { getQueueDriver, queues } from "../queue";
import {
  notifyPipelineBookmarkTerminal,
  shouldExecutePipelineClustering,
} from "../pipelineCoordinator";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("../cancellation", () => ({
  isUserCancelled: vi.fn(),
}));

vi.mock("../queue", () => ({
  getQueueDriver: vi.fn(() => "test"),
  queues: {
    clustering: { add: vi.fn(), remove: vi.fn() },
  },
}));

describe("pipelineCoordinator", () => {
  const claimId = "00000000-0000-0000-0000-000000000007";

  beforeEach(() => {
    vi.clearAllMocks();
    (isUserCancelled as any).mockResolvedValue(false);
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { generation: 7 }, error: null }),
    });
    (supabase.rpc as any).mockResolvedValue({ data: true, error: null });
    (queues.clustering.remove as any).mockResolvedValue(false);
  });

  it("queues fresh clustering jobs by pipelineRunId with run generation context", async () => {
    (supabase.rpc as any)
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: claimId, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await notifyPipelineBookmarkTerminal(
      "user-1",
      undefined,
      "run-7",
      "bookmark-7",
      {
        folderDensity: "more",
        namingTone: "playful",
        useEmojiNames: false,
      },
    );

    expect(queues.clustering.add).toHaveBeenCalledWith(
      "cluster",
      {
        userId: "user-1",
        pipelineRunId: "run-7",
        jobGeneration: 7,
        clusteringSettings: {
          folderDensity: "more",
          namingTone: "playful",
          useEmojiNames: false,
        },
      },
      { jobId: "cluster-user-1-run-run-7" },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      "record_user_pipeline_bookmark_terminal",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_bookmark_id: "bookmark-7",
      },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      "claim_user_pipeline_clustering",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
      },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      3,
      "record_user_pipeline_clustering_enqueued",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_claim_id: claimId,
      },
    );
  });

  it("does not claim clustering until staged terminal counters indicate readiness", async () => {
    (supabase.rpc as any).mockResolvedValueOnce({ data: false, error: null });

    await notifyPipelineBookmarkTerminal("user-1", 7, "run-7", "bookmark-7", {
      folderDensity: "more",
      namingTone: "playful",
      useEmojiNames: false,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "record_user_pipeline_bookmark_terminal",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_bookmark_id: "bookmark-7",
      },
    );
    expect(queues.clustering.add).not.toHaveBeenCalled();
  });

  it("releases the clustering claim when queueing fails", async () => {
    (supabase.rpc as any)
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: claimId, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    (queues.clustering.add as any).mockRejectedValueOnce(
      new Error("queue unavailable"),
    );

    await expect(
      notifyPipelineBookmarkTerminal("user-1", 7, "run-7", "bookmark-7", {
        folderDensity: "more",
        namingTone: "playful",
        useEmojiNames: false,
      }),
    ).rejects.toThrow("queue unavailable");

    expect(supabase.rpc).toHaveBeenCalledTimes(3);
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      3,
      "release_user_pipeline_clustering_claim",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_claim_id: claimId,
      },
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "record_user_pipeline_clustering_enqueued",
      expect.anything(),
    );
  });

  it("retries enqueue recording and releases the claim/removes the queued job when recording keeps failing", async () => {
    const recordError = new Error("record failed");
    (supabase.rpc as any)
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: claimId, error: null })
      .mockResolvedValueOnce({ data: null, error: recordError })
      .mockResolvedValueOnce({ data: null, error: recordError })
      .mockResolvedValueOnce({ data: null, error: recordError })
      .mockResolvedValueOnce({ data: null, error: null });
    (queues.clustering.remove as any).mockResolvedValueOnce(true);

    await expect(
      notifyPipelineBookmarkTerminal("user-1", 7, "run-7", "bookmark-7", {
        folderDensity: "more",
        namingTone: "playful",
        useEmojiNames: false,
      }),
    ).rejects.toThrow("record failed");

    expect(queues.clustering.add).toHaveBeenCalledWith(
      "cluster",
      {
        userId: "user-1",
        pipelineRunId: "run-7",
        jobGeneration: 7,
        clusteringSettings: {
          folderDensity: "more",
          namingTone: "playful",
          useEmojiNames: false,
        },
      },
      { jobId: "cluster-user-1-run-run-7" },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      3,
      "record_user_pipeline_clustering_enqueued",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_claim_id: claimId,
      },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      4,
      "record_user_pipeline_clustering_enqueued",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_claim_id: claimId,
      },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      5,
      "record_user_pipeline_clustering_enqueued",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_claim_id: claimId,
      },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      6,
      "release_user_pipeline_clustering_claim",
      {
        p_user_id: "user-1",
        p_job_generation: 7,
        p_claim_id: claimId,
      },
    );
    expect(queues.clustering.remove).toHaveBeenCalledWith(
      "cluster-user-1-run-run-7",
    );
  });

  it("logs an orphan-clustering warning when enqueue recording fails and remove cannot dequeue outside test mode", async () => {
    const recordError = new Error("record failed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    (getQueueDriver as any).mockReturnValue("sqs");
    (supabase.rpc as any)
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: claimId, error: null })
      .mockResolvedValueOnce({ data: null, error: recordError })
      .mockResolvedValueOnce({ data: null, error: recordError })
      .mockResolvedValueOnce({ data: null, error: recordError })
      .mockResolvedValueOnce({ data: null, error: null });
    (queues.clustering.remove as any).mockResolvedValueOnce(false);

    await expect(
      notifyPipelineBookmarkTerminal("user-1", 7, "run-7", "bookmark-7", {
        folderDensity: "more",
        namingTone: "playful",
        useEmojiNames: false,
      }),
    ).rejects.toThrow("record failed");

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "Could not remove queued clustering job after enqueue-record failure",
      ),
      expect.objectContaining({
        userId: "user-1",
        jobGeneration: 7,
        claimId,
        jobId: "cluster-user-1-run-run-7",
      }),
    );
    consoleError.mockRestore();
  });

  describe("shouldExecutePipelineClustering", () => {
    it("returns false when clustering was never enqueued and the claim was released", async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            status: "running",
            totals: {},
          },
          error: null,
        }),
      });

      await expect(
        shouldExecutePipelineClustering("user-1", 7, "run-7"),
      ).resolves.toBe(false);
    });

    it("returns true when clusteringEnqueuedAt is recorded", async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            status: "running",
            totals: { clusteringEnqueuedAt: "2026-06-07T00:00:00.000Z" },
          },
          error: null,
        }),
      });

      await expect(
        shouldExecutePipelineClustering("user-1", 7, "run-7"),
      ).resolves.toBe(true);
    });
  });
});
