import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../db";

vi.mock("../../db", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe("userContext", () => {
  const originalEnv = process.env.FREE_TIER_LIMIT;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.FREE_TIER_LIMIT = originalEnv;
  });

  describe("FREE_TIER_LIMIT parsing", () => {
    it("uses env value when it is a full decimal integer > 0", async () => {
      process.env.FREE_TIER_LIMIT = "1000";
      const { FREE_TIER_LIMIT } = await import("../userContext");
      expect(FREE_TIER_LIMIT).toBe(1000);
    });

    it("falls back to DEFAULT_FREE_TIER_LIMIT when env value is non-positive", async () => {
      process.env.FREE_TIER_LIMIT = "0";
      const { FREE_TIER_LIMIT, DEFAULT_FREE_TIER_LIMIT } =
        await import("../userContext");
      expect(FREE_TIER_LIMIT).toBe(DEFAULT_FREE_TIER_LIMIT);
    });

    it("falls back to DEFAULT_FREE_TIER_LIMIT when env value is negative", async () => {
      process.env.FREE_TIER_LIMIT = "-500";
      const { FREE_TIER_LIMIT, DEFAULT_FREE_TIER_LIMIT } =
        await import("../userContext");
      expect(FREE_TIER_LIMIT).toBe(DEFAULT_FREE_TIER_LIMIT);
    });

    it("falls back to DEFAULT_FREE_TIER_LIMIT when env value contains non-digits", async () => {
      process.env.FREE_TIER_LIMIT = "500abc";
      const { FREE_TIER_LIMIT, DEFAULT_FREE_TIER_LIMIT } =
        await import("../userContext");
      expect(FREE_TIER_LIMIT).toBe(DEFAULT_FREE_TIER_LIMIT);
    });

    it("falls back to DEFAULT_FREE_TIER_LIMIT when env value is a float", async () => {
      process.env.FREE_TIER_LIMIT = "500.5";
      const { FREE_TIER_LIMIT, DEFAULT_FREE_TIER_LIMIT } =
        await import("../userContext");
      expect(FREE_TIER_LIMIT).toBe(DEFAULT_FREE_TIER_LIMIT);
    });

    it("falls back to DEFAULT_FREE_TIER_LIMIT when env value is undefined", async () => {
      delete process.env.FREE_TIER_LIMIT;
      const { FREE_TIER_LIMIT, DEFAULT_FREE_TIER_LIMIT } =
        await import("../userContext");
      expect(FREE_TIER_LIMIT).toBe(DEFAULT_FREE_TIER_LIMIT);
    });
  });

  describe("getUserPremiumStatus error logging", () => {
    it("redacts the userId and logs error details", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const mockError = { message: "DB connection failure" };

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: null, error: mockError }),
      });

      const { getUserPremiumStatus } = await import("../userContext");

      const fullUserId = "12345678-abcd-1234-abcd-1234567890ab";
      const status = await getUserPremiumStatus(fullUserId);

      expect(status).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      const loggedMessage = consoleErrorSpy.mock.calls[0][0];
      const loggedError = consoleErrorSpy.mock.calls[0][1];

      expect(loggedMessage).toContain("12345678...");
      expect(loggedMessage).not.toContain(fullUserId);
      expect(loggedError).toBe(mockError);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("requireRequestUserId auth bypass", () => {
    it("rejects unauthenticated requests by default", async () => {
      const { requireRequestUserId } = await import("../userContext");
      const mockReq = {
        headers: {},
        params: { userId: "user-1" },
        body: {},
      } as any;
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      const result = await requireRequestUserId(mockReq, mockReply);
      expect(result).toBeNull();
      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Authentication required.",
      });
    });

    it("allows unauthenticated requests when setAllowUnauthenticatedForTesting(true) is called", async () => {
      const { requireRequestUserId, setAllowUnauthenticatedForTesting } =
        await import("../userContext");
      setAllowUnauthenticatedForTesting(true);

      const mockReq = {
        headers: {},
        params: { userId: "user-1" },
        body: {},
      } as any;
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      const result = await requireRequestUserId(mockReq, mockReply);
      expect(result).toBe("user-1");
      expect(mockReply.code).not.toHaveBeenCalled();

      setAllowUnauthenticatedForTesting(false);
    });
  });
});
