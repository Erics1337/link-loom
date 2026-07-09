import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../db";
import {
  beginUserPipelineRun,
  completePipelineRun,
  failPipelineRun,
} from "../../lib/cancellation";
import {
  countSnapshotAssignments,
  registerCloudSnapshotRoutes,
} from "../backups";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("../../lib/cancellation", () => ({
  beginUserPipelineRun: vi.fn(),
  completePipelineRun: vi.fn(),
  failPipelineRun: vi.fn(),
}));

vi.mock("../../lib/userContext", () => ({
  requireRequestUserId: vi.fn().mockResolvedValue("user-1"),
}));

describe("countSnapshotAssignments", () => {
  it("reads Supabase aggregate count shape", () => {
    expect(countSnapshotAssignments([{ count: 12 }])).toBe(12);
  });

  it("sums counts across multiple assignment objects", () => {
    expect(countSnapshotAssignments([{ count: 3 }, { count: 5 }])).toBe(8);
  });

  it("counts assignment rows when count fields are absent", () => {
    expect(
      countSnapshotAssignments([
        { bookmark_id: "bookmark-1" },
        { bookmark_id: "bookmark-2" },
        { bookmark_id: "bookmark-3" },
      ]),
    ).toBe(3);
  });
});

describe("registerCloudSnapshotRoutes restore handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (beginUserPipelineRun as any).mockResolvedValue({
      id: "run-1",
      generation: 1,
    });
    (completePipelineRun as any).mockResolvedValue(undefined);
    (failPipelineRun as any).mockResolvedValue(undefined);
  });

  it("completes pipeline run on successful restore", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
      get: vi.fn(),
      delete: vi.fn(),
    };

    (supabase.rpc as any).mockResolvedValue({ error: null });

    await registerCloudSnapshotRoutes(fastify as any);
    const handler = handlers.get("/backups/:userId/:snapshotId/restore");

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };

    const response = await handler?.(
      {
        params: { snapshotId: "snapshot-123" },
      },
      reply,
    );

    expect(response).toEqual({ status: "restored" });
    expect(beginUserPipelineRun).toHaveBeenCalledWith("user-1");
    expect(supabase.rpc).toHaveBeenCalledWith("restore_structure_snapshot", {
      p_user_id: "user-1",
      p_snapshot_id: "snapshot-123",
    });
    expect(completePipelineRun).toHaveBeenCalledWith("run-1");
    expect(failPipelineRun).not.toHaveBeenCalled();
  });

  it("fails pipeline run and propagates error on failed restore rpc", async () => {
    const handlers = new Map<string, Function>();
    const fastify = {
      post: vi.fn((path: string, _options: unknown, handler: Function) => {
        handlers.set(path, handler);
      }),
      get: vi.fn(),
      delete: vi.fn(),
    };

    const rpcError = new Error("RPC failed");
    (supabase.rpc as any).mockResolvedValue({ error: rpcError });

    await registerCloudSnapshotRoutes(fastify as any);
    const handler = handlers.get("/backups/:userId/:snapshotId/restore");

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };

    const response = await handler?.(
      {
        params: { snapshotId: "snapshot-123" },
      },
      reply,
    );

    expect(response).toEqual({ error: "Failed to restore Cloud Snapshot" });
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(beginUserPipelineRun).toHaveBeenCalledWith("user-1");
    expect(completePipelineRun).not.toHaveBeenCalled();
    expect(failPipelineRun).toHaveBeenCalledWith("run-1", {
      error: "RPC failed",
    });
  });
});
