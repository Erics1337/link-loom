import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../db";
import { registerAuthRoutes } from "../auth";

vi.mock("../../db", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock("../../lib/userContext", () => ({
  requireRequestUserId: vi.fn().mockResolvedValue("user-1"),
  ensureUserExists: vi.fn().mockResolvedValue(null),
}));

describe("auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defines schema with 400 response mapped to errorResponseSchema", async () => {
    let capturedSchema: any = null;
    const fastify = {
      post: vi.fn((path: string, options: any, handler: Function) => {
        if (path === "/register-device") {
          capturedSchema = options.schema;
        }
      }),
    };

    await registerAuthRoutes(fastify as any);

    expect(capturedSchema).toBeDefined();
    expect(capturedSchema.response).toBeDefined();
    expect(capturedSchema.response[400]).toBeDefined();
    expect(capturedSchema.response[400].properties.error).toBeDefined();
  });

  it("returns 400 if deviceId is empty", async () => {
    let capturedHandler: any = null;
    const fastify = {
      post: vi.fn((path: string, options: any, handler: Function) => {
        if (path === "/register-device") {
          capturedHandler = handler;
        }
      }),
    };

    await registerAuthRoutes(fastify as any);

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };

    const req = {
      body: {
        deviceId: "   ",
        name: "Test Device",
      },
    };

    const response = await capturedHandler(req, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(response).toEqual({ error: "deviceId is required" });
  });

  it("registers device successfully", async () => {
    let capturedHandler: any = null;
    const fastify = {
      post: vi.fn((path: string, options: any, handler: Function) => {
        if (path === "/register-device") {
          capturedHandler = handler;
        }
      }),
    };

    await registerAuthRoutes(fastify as any);

    (supabase.rpc as any).mockResolvedValue({
      data: { status: "registered" },
      error: null,
    });

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn((payload: unknown) => payload),
    };

    const req = {
      body: {
        deviceId: "device-123",
        name: "My iPad",
      },
    };

    const response = await capturedHandler(req, reply);
    expect(supabase.rpc).toHaveBeenCalledWith("register_user_device", {
      p_user_id: "user-1",
      p_device_id: "device-123",
      p_device_name: "My iPad",
    });
    expect(response).toEqual({ status: "registered" });
  });
});
