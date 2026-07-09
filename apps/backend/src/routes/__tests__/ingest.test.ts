import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../db";
import {
  beginUserPipelineRun,
  failPipelineRun,
  markUserCancelled,
} from "../../lib/cancellation";
import { recordPipelineRunStarted } from "../../lib/pipelineCoordinator";
import { queues } from "../../lib/queue";
import { ensureUserExists, getUserPremiumStatus } from "../../lib/userContext";
import { registerIngestRoutes } from "../ingest";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("../../lib/cancellation", () => ({
  beginUserPipelineRun: vi.fn(),
  failPipelineRun: vi.fn(),
  markUserCancelled: vi.fn(),
}));

vi.mock("../../lib/pipelineCoordinator", () => ({
  recordPipelineRunStarted: vi.fn(),
}));

vi.mock("../../lib/queue", () => ({
  queues: {
    clustering: { add: vi.fn() },
    ingest: { add: vi.fn() },
  },
}));

vi.mock("../../lib/userContext", () => ({
  ensureUserExists: vi.fn(),
  FREE_TIER_LIMIT: 500,
  getUserPremiumStatus: vi.fn(),
  requireRequestUserId: vi.fn().mockResolvedValue("user-1"),
}));

describe("ingest routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (beginUserPipelineRun as any).mockResolvedValue({
      id: "run-1",
      generation: 1,
    });
    (failPipelineRun as any).mockResolvedValue(undefined);
  });

  it("registers strict body schemas for ingest route payloads", async () => {
    const posts: Array<{ path: string; options: any }> = [];
    const fastify = {
      post: vi.fn((path: string, options: any, _handler: Function) => {
        posts.push({ path, options });
      }),
    };

    await registerIngestRoutes(fastify as any);

    expect(
      posts.find((post) => post.path === "/ingest")?.options.schema.body,
    ).toMatchObject({
      required: ["bookmarks"],
      additionalProperties: false,
      properties: {
        bookmarks: {
          type: "array",
          items: { type: "object" },
        },
      },
    });
    expect(
      posts.find((post) => post.path === "/trigger-clustering/:userId")?.options
        .schema.body,
    ).toMatchObject({
      additionalProperties: false,
      properties: {
        clusteringSettings: { type: "object" },
      },
    });
    expect(
      posts.find((post) => post.path === "/confirm-apply/:userId")?.options
        .schema.body,
    ).toMatchObject({
      additionalProperties: false,
      properties: {
        folderChromeIds: {
          type: "array",
          items: {
            required: ["clusterId", "chromeFolderId"],
          },
        },
      },
    });
  });

  it("records settings and totals for manually triggered clustering runs", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 42, error: null }),
    };
    (supabase.from as any).mockReturnValue(countChain);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/trigger-clustering/:userId");
    const response = await handler?.(
      {
        body: {
          clusteringSettings: { folderDensity: "more", namingTone: "playful" },
        },
      },
      {},
    );

    expect(response).toEqual({ status: "clustering_queued" });
    expect(recordPipelineRunStarted).toHaveBeenCalledWith(
      "user-1",
      1,
      42,
      expect.objectContaining({
        folderDensity: "more",
        namingTone: "playful",
      }),
    );
    expect(queues.clustering.add).toHaveBeenCalledWith(
      "cluster",
      expect.objectContaining({
        userId: "user-1",
        pipelineRunId: "run-1",
        clusteringSettings: expect.objectContaining({ folderDensity: "more" }),
      }),
      { jobId: "cluster-user-1-manual-run-run-1" },
    );
  });

  it("does not create a manual clustering run when bookmark counting fails", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi
        .fn()
        .mockResolvedValue({ count: null, error: { message: "count failed" } }),
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };
    (supabase.from as any).mockReturnValue(countChain);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/trigger-clustering/:userId");
    const response = await handler?.({ body: {} }, reply);

    expect(response).toEqual({ error: "Failed to initialize clustering run" });
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(beginUserPipelineRun).not.toHaveBeenCalled();
    expect(recordPipelineRunStarted).not.toHaveBeenCalled();
    expect(queues.clustering.add).not.toHaveBeenCalled();
  });

  it("marks manual clustering pipeline runs failed when queueing fails", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const countChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ count: 42, error: null }),
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };
    const enqueueError = new Error("queue unavailable");
    (supabase.from as any).mockReturnValue(countChain);
    (queues.clustering.add as any).mockRejectedValueOnce(enqueueError);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/trigger-clustering/:userId");
    const response = await handler?.({ body: {} }, reply);

    expect(response).toEqual({ error: "Failed to queue clustering run" });
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(failPipelineRun).toHaveBeenCalledWith("run-1", {
      reason: "enqueue_failed",
      generation: 1,
      error: "queue unavailable",
    });
  });

  it("starts a pipeline run and queues ingest for /ingest", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const bookmarks = [{ url: "https://example.com", title: "Example" }];
    (ensureUserExists as any).mockResolvedValue(null);
    (getUserPremiumStatus as any).mockResolvedValue(true);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/ingest");
    const response = await handler?.(
      {
        body: {
          bookmarks,
          clusteringSettings: { folderDensity: "more", namingTone: "playful" },
        },
      },
      {},
    );

    expect(response).toEqual({ status: "queued" });
    expect(beginUserPipelineRun).toHaveBeenCalledWith("user-1");
    expect(recordPipelineRunStarted).toHaveBeenCalledWith(
      "user-1",
      1,
      1,
      expect.objectContaining({
        folderDensity: "more",
        namingTone: "playful",
      }),
    );
    // Ingest no longer wipes existing bookmarks/clusters before queueing —
    // the worker diffs against what's already stored instead.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "clear_user_ingest_structure",
      expect.anything(),
    );
    expect(queues.ingest.add).toHaveBeenCalledWith(
      "ingest",
      expect.objectContaining({
        userId: "user-1",
        bookmarks,
        pipelineRunId: "run-1",
        clusteringSettings: expect.objectContaining({ folderDensity: "more" }),
      }),
      { jobId: "ingest-user-1-run-run-1" },
    );
  });

  it("rejects non-array bookmarks before creating an ingest job", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/ingest");
    const response = await handler?.(
      {
        body: {
          bookmarks: "not-an-array",
        },
      },
      reply,
    );

    expect(response).toEqual({ error: "Bookmarks must be an array" });
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(ensureUserExists).not.toHaveBeenCalled();
    expect(beginUserPipelineRun).not.toHaveBeenCalled();
    expect(queues.ingest.add).not.toHaveBeenCalled();
  });

  it("marks ingest pipeline runs failed when queueing fails", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const bookmarks = [{ url: "https://example.com", title: "Example" }];
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };
    const enqueueError = new Error("queue unavailable");
    (ensureUserExists as any).mockResolvedValue(null);
    (getUserPremiumStatus as any).mockResolvedValue(true);
    (queues.ingest.add as any).mockRejectedValueOnce(enqueueError);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/ingest");
    const response = await handler?.(
      {
        body: {
          bookmarks,
        },
      },
      reply,
    );

    expect(response).toEqual({ error: "Failed to queue ingest run" });
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(failPipelineRun).toHaveBeenCalledWith("run-1", {
      reason: "enqueue_failed",
      generation: 1,
      error: "queue unavailable",
    });
  });

  it("records folder mappings for /confirm-apply/:userId", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const updateChain = {
      update: vi
        .fn()
        .mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: updateEq }) }),
    };
    (supabase.from as any).mockReturnValue(updateChain);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/confirm-apply/:userId");
    const response = await handler?.(
      {
        body: {
          folderChromeIds: [
            { clusterId: "cluster-1", chromeFolderId: "chrome-folder-1" },
          ],
        },
      },
      {},
    );

    expect(response).toEqual({ status: "ok" });
    expect(updateChain.update).toHaveBeenCalledWith({
      chrome_folder_id: "chrome-folder-1",
    });
  });

  it("rejects non-array folder mappings before updating clusters", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/confirm-apply/:userId");
    const response = await handler?.(
      {
        body: {
          folderChromeIds: "not-an-array",
        },
      },
      reply,
    );

    expect(response).toEqual({ error: "Folder mappings must be an array" });
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("marks the user cancelled and resets bookmark status for /cancel/:userId", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ error: null }),
    };
    (supabase.from as any).mockReturnValue(updateChain);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/cancel/:userId");
    const response = await handler?.({}, {});

    expect(response).toEqual({ status: "cancelled" });
    expect(markUserCancelled).toHaveBeenCalledWith("user-1");
    expect(updateChain.update).toHaveBeenCalledWith({ status: "idle" });
    expect(updateChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(updateChain.in).toHaveBeenCalledWith("status", [
      "pending",
      "enriched",
    ]);
  });

  it("returns an error when /cancel/:userId fails to reset bookmark status", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
    };
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ error: { message: "update failed" } }),
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };
    (supabase.from as any).mockReturnValue(updateChain);

    await registerIngestRoutes(fastify as any);
    const handler = handlers.get("/cancel/:userId");
    const response = await handler?.({}, reply);

    expect(response).toEqual({ error: "Failed to reset status" });
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(markUserCancelled).toHaveBeenCalledWith("user-1");
  });
});
