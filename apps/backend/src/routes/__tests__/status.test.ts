import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../db";
import { registerStatusRoutes } from "../status";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("../../lib/userContext", () => ({
  requireRequestUserId: vi.fn().mockResolvedValue("user-1"),
}));

const captureGetHandler = async () => {
  const handlers = new Map<string, Function>();
  const fastify = {
    get: vi.fn((path: string, _options: unknown, handler: Function) => {
      handlers.set(path, handler);
    }),
  };

  await registerStatusRoutes(fastify as any);
  const handler = handlers.get("/status/:userId");
  if (!handler) throw new Error("Missing status handler.");
  return handler;
};

const createMaybeSingleChain = (data: unknown, error: unknown = null) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data, error }),
});

const mockRunLookups = (run: Record<string, unknown> | null) => {
  (supabase.from as any).mockImplementation((table: string) => {
    if (table === "users") {
      return createMaybeSingleChain({ is_premium: true });
    }
    if (table === "user_pipeline_controls") {
      return createMaybeSingleChain({
        current_pipeline_run_id: run?.id ?? null,
      });
    }
    if (table === "pipeline_runs") {
      return createMaybeSingleChain(run);
    }
    throw new Error(`Unexpected table ${table}`);
  });
};

describe("status routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses run-scoped counts for a running pipeline run", async () => {
    const run = {
      id: "run-1",
      generation: 4,
      status: "running",
      totals: { total: 10, untrackedErrors: 0 },
    };
    mockRunLookups(run);
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          total_bookmarks: 99,
          pending_bookmarks: 2,
          enriched_bookmarks: 3,
          embedded_bookmarks: 4,
          errored_bookmarks: 1,
          assigned_bookmarks: 0,
          cluster_count: 0,
        },
      ],
      error: null,
    });

    const handler = await captureGetHandler();
    const response = await handler({}, {});

    expect(response).toEqual(
      expect.objectContaining({
        pending: 5,
        pendingRaw: 2,
        enriched: 3,
        embedded: 4,
        errored: 1,
        total: 10,
        assigned: 0,
        clusters: 0,
        ingestProcessed: 10,
        ingestTotal: 10,
        isIngesting: true,
        isDone: false,
        pipelineRunId: "run-1",
        pipelineGeneration: 4,
        pipelineStatus: "running",
      }),
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "get_pipeline_run_status_counts",
      {
        p_user_id: "user-1",
        p_pipeline_run_id: "run-1",
      },
    );
    expect(
      (supabase.from as any).mock.calls.map(([table]: [string]) => table),
    ).not.toContain("bookmarks");
  });

  it("keeps newly started runs ingesting before scoped bookmarks are inserted", async () => {
    const run = {
      id: "run-preinsert",
      generation: 8,
      status: "running",
      totals: { total: 25, untrackedErrors: 0 },
    };
    mockRunLookups(run);
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          total_bookmarks: 0,
          pending_bookmarks: 0,
          enriched_bookmarks: 0,
          embedded_bookmarks: 0,
          errored_bookmarks: 0,
          assigned_bookmarks: 0,
          cluster_count: 0,
        },
      ],
      error: null,
    });

    const handler = await captureGetHandler();
    const response = await handler({}, {});

    expect(response).toEqual(
      expect.objectContaining({
        pending: 0,
        isIngesting: true,
        ingestProcessed: 0,
        total: 25,
        isClusteringActive: false,
        isDone: false,
      }),
    );
  });

  it("marks completed runs done even when scoped counts still look incomplete", async () => {
    const run = {
      id: "run-2",
      generation: 5,
      status: "completed",
      totals: { total: 10, untrackedErrors: 0 },
    };
    mockRunLookups(run);
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          total_bookmarks: 10,
          pending_bookmarks: 2,
          enriched_bookmarks: 1,
          embedded_bookmarks: 3,
          errored_bookmarks: 0,
          assigned_bookmarks: 1,
          cluster_count: 0,
        },
      ],
      error: null,
    });

    const handler = await captureGetHandler();
    const response = await handler({}, {});

    expect(response).toEqual(
      expect.objectContaining({
        pending: 3,
        remainingToAssign: 2,
        isDone: true,
        pipelineRunId: "run-2",
        pipelineStatus: "completed",
      }),
    );
  });

  it.each(["cancelled", "failed"])(
    "treats %s runs as terminal without marking them completed",
    async (status) => {
      const run = {
        id: `run-${status}`,
        generation: 9,
        status,
        totals: { total: 10, untrackedErrors: 0 },
      };
      mockRunLookups(run);
      (supabase.rpc as any).mockResolvedValue({
        data: [
          {
            total_bookmarks: 4,
            pending_bookmarks: 1,
            enriched_bookmarks: 0,
            embedded_bookmarks: 3,
            errored_bookmarks: 0,
            assigned_bookmarks: 0,
            cluster_count: 0,
          },
        ],
        error: null,
      });

      const handler = await captureGetHandler();
      const response = await handler({}, {});

      expect(response).toEqual(
        expect.objectContaining({
          isDone: true,
          isIngesting: false,
          isClusteringActive: false,
          pipelineStatus: status,
        }),
      );
    },
  );

  it("does not count enriched bookmarks as terminal ingest progress", async () => {
    const run = {
      id: "run-enriched",
      generation: 11,
      status: "running",
      totals: {
        total: 10,
        ingestCompletedAt: "2026-06-07T00:00:00.000Z",
        untrackedErrors: 0,
      },
    };
    mockRunLookups(run);
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          total_bookmarks: 10,
          pending_bookmarks: 0,
          enriched_bookmarks: 5,
          embedded_bookmarks: 3,
          errored_bookmarks: 1,
          assigned_bookmarks: 0,
          cluster_count: 0,
        },
      ],
      error: null,
    });

    const handler = await captureGetHandler();
    const response = await handler({}, {});

    expect(response).toEqual(
      expect.objectContaining({
        pending: 5,
        enriched: 5,
        embedded: 3,
        errored: 1,
        isIngesting: false,
        ingestProcessed: 10,
        ingestTotal: 10,
      }),
    );
  });

  it("includes untracked errors stored on the run totals", async () => {
    const run = {
      id: "run-3",
      generation: 6,
      status: "running",
      totals: { total: 8, untrackedErrors: 2 },
    };
    mockRunLookups(run);
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          total_bookmarks: 6,
          pending_bookmarks: 1,
          enriched_bookmarks: 0,
          embedded_bookmarks: 4,
          errored_bookmarks: 1,
          assigned_bookmarks: 2,
          cluster_count: 1,
        },
      ],
      error: null,
    });

    const handler = await captureGetHandler();
    const response = await handler({}, {});

    expect(response).toEqual(
      expect.objectContaining({
        total: 8,
        errored: 3,
        ingestProcessed: 6,
        remainingToAssign: 2,
        isIngesting: true,
        isDone: false,
      }),
    );
  });

  it("falls back to legacy user-scoped counts when no pipeline run exists", async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === "users")
        return createMaybeSingleChain({ is_premium: false });
      if (table === "user_pipeline_controls")
        return createMaybeSingleChain({ current_pipeline_run_id: null });
      if (table === "pipeline_runs") return createMaybeSingleChain(null);
      throw new Error(`Unexpected table ${table}`);
    });
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          total_bookmarks: 12,
          pending_bookmarks: 0,
          enriched_bookmarks: 0,
          embedded_bookmarks: 7,
          errored_bookmarks: 0,
          assigned_bookmarks: 7,
          cluster_count: 4,
        },
      ],
      error: null,
    });

    const handler = await captureGetHandler();
    const response = await handler({}, {});

    expect(supabase.rpc).toHaveBeenCalledWith("get_legacy_status_counts", {
      p_user_id: "user-1",
    });
    expect(response).toEqual(
      expect.objectContaining({
        pending: 0,
        pendingRaw: 0,
        enriched: 0,
        embedded: 7,
        errored: 0,
        total: 12,
        clusters: 4,
        assigned: 7,
        isPremium: false,
        isDone: true,
        pipelineRunId: null,
        pipelineGeneration: null,
        pipelineStatus: null,
      }),
    );
  });

  it("returns a server error when run-scoped count loading fails", async () => {
    const run = {
      id: "run-error",
      generation: 10,
      status: "running",
      totals: { total: 10, untrackedErrors: 0 },
    };
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };
    mockRunLookups(run);
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "rpc exploded" },
    });

    const handler = await captureGetHandler();
    const response = await handler({}, reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(response).toEqual({ error: "Failed to load run status counts" });
  });
});
