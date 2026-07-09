import { describe, expect, it } from "vitest";
import { normalizeBookmarkUrl } from "../normalizeUrl";

describe("normalizeBookmarkUrl", () => {
  it("lowercases scheme and host and strips default ports", () => {
    expect(normalizeBookmarkUrl("HTTPS://Example.COM:443/Path")).toBe(
      "https://example.com/Path",
    );
  });

  it("preserves valid fragments and SPA routes but strips tracking ones", () => {
    expect(normalizeBookmarkUrl("https://example.com/docs/#section")).toBe(
      "https://example.com/docs#section",
    );
    expect(normalizeBookmarkUrl("https://example.com/#/home/dashboard")).toBe(
      "https://example.com/#/home/dashboard",
    );
    expect(
      normalizeBookmarkUrl("https://example.com/docs/#utm_source=twitter"),
    ).toBe("https://example.com/docs");
    expect(
      normalizeBookmarkUrl(
        "https://example.com/#/home?utm_source=twitter&ref=123",
      ),
    ).toBe("https://example.com/#/home?ref=123");
    expect(
      normalizeBookmarkUrl(
        "https://example.com/#utm_source=twitter&fbclid=abc",
      ),
    ).toBe("https://example.com/");
  });

  it("drops tracking params but keeps meaningful ones", () => {
    expect(
      normalizeBookmarkUrl(
        "https://example.com/article?utm_source=news&utm_medium=email&id=42&fbclid=abc",
      ),
    ).toBe("https://example.com/article?id=42");
  });

  it("sorts remaining query params so ordering variants match", () => {
    expect(normalizeBookmarkUrl("https://example.com/?b=2&a=1")).toBe(
      normalizeBookmarkUrl("https://example.com/?a=1&b=2"),
    );
  });

  it("returns trimmed input for unparseable urls", () => {
    expect(normalizeBookmarkUrl(" not-a-url ")).toBe("not-a-url");
  });
});
