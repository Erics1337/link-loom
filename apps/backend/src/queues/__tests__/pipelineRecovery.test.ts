import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../db";
import { queues } from "../../lib/queue";
import { recoverStalePipelineState } from "../clustering/pipelineRecovery";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("../../lib/queue", () => ({
  queues: {
    enrichment: { add: vi.fn() },
    embedding: { add: vi.fn() },
  },
}));

const createQuery = (result: unknown) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue(result),
  update: vi.fn().mockReturnThis(),
});

describe("recoverStalePipelineState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates jobGeneration to recovered enrichment and embedding jobs", async () => {
    const log = vi.fn();
    const query = createQuery({
      data: [
        {
          id: "bookmark-pending",
          status: "pending",
          url: "https://example.com/pending",
          shared_links: null,
        },
        {
          id: "bookmark-enriched",
          status: "enriched",
          title: "Example",
          description: "Recovered",
          url: "https://example.com/enriched",
          shared_links: null,
        },
      ],
      error: null,
    });
    (supabase.from as any).mockReturnValue(query);

    await recoverStalePipelineState("user-1", "run-9", 9, log);

    expect(queues.enrichment.add).toHaveBeenCalledWith(
      "enrich",
      {
        userId: "user-1",
        pipelineRunId: "run-9",
        jobGeneration: 9,
        bookmarkId: "bookmark-pending",
        url: "https://example.com/pending",
      },
      {
        jobId: "enrich-user-1-run-run-9-bookmark-pending",
      },
    );
    expect(queues.embedding.add).toHaveBeenCalledWith(
      "embed",
      {
        userId: "user-1",
        pipelineRunId: "run-9",
        jobGeneration: 9,
        bookmarkId: "bookmark-enriched",
        url: "https://example.com/enriched",
      },
      {
        jobId: "embed-user-1-run-run-9-bookmark-enriched",
      },
    );
  });

  it("continues recovery when an individual queue add fails", async () => {
    const log = vi.fn();
    const query = createQuery({
      data: [
        {
          id: "bookmark-pending-1",
          status: "pending",
          url: "https://example.com/pending-1",
          shared_links: null,
        },
        {
          id: "bookmark-pending-2",
          status: "pending",
          url: "https://example.com/pending-2",
          shared_links: null,
        },
      ],
      error: null,
    });
    (supabase.from as any).mockReturnValue(query);
    (queues.enrichment.add as any)
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce(undefined);

    await recoverStalePipelineState("user-1", "run-9", 9, log);

    expect(queues.enrichment.add).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Recovery failed to queue enrichment for user user-1",
      ),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"userId":"user-1"'),
    );
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("url"));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"bookmarkId":"bookmark-pending-1"'),
    );
    expect(log).toHaveBeenCalledWith(
      "[CLUSTERING] Recovery queued enrichment=1/2, embedding=0/0 for user user-1 (failures: enrichment=1, embedding=0)",
    );
  });
});
