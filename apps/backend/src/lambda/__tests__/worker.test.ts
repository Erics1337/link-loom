import { SQSEvent } from "aws-lambda";
import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const upsert = vi.fn();
  const update = vi.fn();
  const eq = vi.fn();
  const inFilter = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === "queue_job_failures") {
      return { upsert };
    }
    if (table === "bookmarks") {
      return { update };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return {
    from,
    upsert,
    update,
    eq,
    inFilter,
    ingestProcessor: vi.fn(),
    enrichmentProcessor: vi.fn(),
    embeddingProcessor: vi.fn(),
    clusteringProcessor: vi.fn(),
    notifyPipelineBookmarkTerminal: vi.fn(),
    recordPipelineUntrackedError: vi.fn(),
    isUserCancelled: vi.fn(),
  };
});

vi.mock("../../db", () => ({
  supabase: {
    from: mocks.from,
  },
}));

vi.mock("../../queues/ingest", () => ({
  ingestProcessor: mocks.ingestProcessor,
}));
vi.mock("../../queues/enrichment", () => ({
  enrichmentProcessor: mocks.enrichmentProcessor,
}));
vi.mock("../../queues/embedding", () => ({
  embeddingProcessor: mocks.embeddingProcessor,
}));
vi.mock("../../queues/clustering", () => ({
  clusteringProcessor: mocks.clusteringProcessor,
}));
vi.mock("../../lib/cancellation", () => ({
  isUserCancelled: mocks.isUserCancelled,
}));
vi.mock("../../lib/pipelineCoordinator", () => ({
  notifyPipelineBookmarkTerminal: mocks.notifyPipelineBookmarkTerminal,
  recordPipelineUntrackedError: mocks.recordPipelineUntrackedError,
}));

const createEvent = (body: unknown, receiveCount: string): SQSEvent =>
  ({
    Records: [
      {
        messageId: "message-1",
        body: JSON.stringify(body),
        attributes: {
          ApproximateReceiveCount: receiveCount,
        },
      },
    ],
  }) as SQSEvent;

describe("lambda queue worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ error: null });
    const filterChain = {
      in: mocks.inFilter,
      eq: mocks.eq,
      then: (resolve: any) => resolve({ error: null }),
    };
    mocks.eq.mockReturnValue(filterChain);
    mocks.inFilter.mockReturnValue(filterChain);
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.isUserCancelled.mockResolvedValue(false);
  });

  it("records exhausted queue failures and marks bookmark-scoped jobs as errored", async () => {
    const { processEvent } = await import("../worker");
    mocks.enrichmentProcessor.mockRejectedValueOnce(
      new Error("scrape exploded"),
    );

    const result = await processEvent(
      "enrichment",
      createEvent(
        {
          queue: "enrichment",
          jobName: "enrich",
          jobId: "enrich-user-1-generation-4-bookmark-1",
          attempts: 3,
          backoffMs: 30000,
          data: {
            userId: "00000000-0000-0000-0000-000000000001",
            pipelineRunId: "00000000-0000-0000-0000-000000000003",
            bookmarkId: "00000000-0000-0000-0000-000000000002",
          },
        },
        "3",
      ),
    );

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        queue_name: "enrichment",
        job_id: "enrich-user-1-generation-4-bookmark-1",
        job_name: "enrich",
        user_id: "00000000-0000-0000-0000-000000000001",
        pipeline_run_id: "00000000-0000-0000-0000-000000000003",
        bookmark_id: "00000000-0000-0000-0000-000000000002",
        attempts: 3,
        receive_count: 3,
        error_message_sanitized: "scrape exploded",
        error_message_hash: createHash("sha256")
          .update("scrape exploded")
          .digest("hex"),
      }),
      { onConflict: "queue_name,job_id" },
    );
    expect(mocks.update).toHaveBeenCalledWith({ status: "error" });
    expect(mocks.eq).toHaveBeenCalledWith(
      "id",
      "00000000-0000-0000-0000-000000000002",
    );
    expect(mocks.eq).toHaveBeenCalledWith(
      "pipeline_run_id",
      "00000000-0000-0000-0000-000000000003",
    );
    expect(mocks.notifyPipelineBookmarkTerminal).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      undefined,
      "00000000-0000-0000-0000-000000000003",
      "00000000-0000-0000-0000-000000000002",
      expect.any(Object),
    );
  });

  it("records exhausted ingest bookmark failures as untracked pipeline errors", async () => {
    const { processEvent } = await import("../worker");
    mocks.ingestProcessor.mockRejectedValueOnce(new Error("ingest exploded"));

    const result = await processEvent(
      "ingest",
      createEvent(
        {
          queue: "ingest",
          jobName: "ingest",
          jobId: "ingest-user-1-run-3",
          attempts: 2,
          backoffMs: 30000,
          data: {
            userId: "00000000-0000-0000-0000-000000000001",
            pipelineRunId: "00000000-0000-0000-0000-000000000003",
            jobGeneration: 3,
            bookmarks: [{ id: "chrome-1" }, { id: "chrome-2" }],
          },
        },
        "2",
      ),
    );

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    expect(mocks.update).toHaveBeenCalledWith({ status: "error" });
    expect(mocks.eq).toHaveBeenCalledWith(
      "user_id",
      "00000000-0000-0000-0000-000000000001",
    );
    expect(mocks.inFilter).toHaveBeenCalledWith("chrome_id", [
      "chrome-1",
      "chrome-2",
    ]);
    expect(mocks.eq).toHaveBeenCalledWith(
      "pipeline_run_id",
      "00000000-0000-0000-0000-000000000003",
    );
    expect(mocks.recordPipelineUntrackedError).toHaveBeenCalledTimes(2);
    expect(mocks.recordPipelineUntrackedError).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      3,
      "00000000-0000-0000-0000-000000000003",
      expect.any(Object),
      "exhausted:ingest-user-1-run-3:chrome-1",
    );
  });

  it("does not mutate bookmarks or notify the coordinator for stale exhausted jobs", async () => {
    const { processEvent } = await import("../worker");
    mocks.ingestProcessor.mockRejectedValueOnce(
      new Error("old ingest exploded"),
    );
    mocks.isUserCancelled.mockResolvedValueOnce(true);

    const result = await processEvent(
      "ingest",
      createEvent(
        {
          queue: "ingest",
          jobName: "ingest",
          jobId: "ingest-user-1-run-old",
          attempts: 1,
          backoffMs: 30000,
          data: {
            userId: "00000000-0000-0000-0000-000000000001",
            pipelineRunId: "00000000-0000-0000-0000-000000000099",
            jobGeneration: 1,
            bookmarks: [{ id: "chrome-1" }],
          },
        },
        "1",
      ),
    );

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    expect(mocks.upsert).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.notifyPipelineBookmarkTerminal).not.toHaveBeenCalled();
    expect(mocks.recordPipelineUntrackedError).not.toHaveBeenCalled();
  });

  it("keeps retrying failed jobs until their configured attempts are exhausted", async () => {
    const { processEvent } = await import("../worker");
    mocks.embeddingProcessor.mockRejectedValueOnce(new Error("rate limited"));

    const result = await processEvent(
      "embedding",
      createEvent(
        {
          queue: "embedding",
          jobName: "embed",
          jobId: "embed-user-1-generation-4-bookmark-1",
          attempts: 5,
          backoffMs: 30000,
          data: {
            userId: "00000000-0000-0000-0000-000000000001",
            bookmarkId: "00000000-0000-0000-0000-000000000002",
          },
        },
        "2",
      ),
    );

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("records fallback queue failure when message is malformed / undefined", async () => {
    const { processEvent } = await import("../worker");

    const result = await processEvent(
      "enrichment",
      createEvent(
        {
          invalidKey: "invalidValue",
        },
        "1",
      ),
    );

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        queue_name: "enrichment",
        job_id: "message-1",
        job_name: "unknown",
        attempts: 1,
        receive_count: 1,
        error_message_sanitized: "Invalid queue message",
        error_message_hash: createHash("sha256")
          .update("Invalid queue message")
          .digest("hex"),
      }),
      { onConflict: "queue_name,job_id" },
    );
  });
});
