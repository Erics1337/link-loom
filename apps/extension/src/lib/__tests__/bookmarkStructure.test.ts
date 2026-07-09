import { describe, expect, it } from "vitest";
import {
  countDuplicateAssignments,
  normalizeBookmarkUrl,
  renameNodeTitleInTree,
} from "../bookmarkStructure";
import { BookmarkRootTitle } from "../bookmarkImport";

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

describe("countDuplicateAssignments", () => {
  const assignment = (url: string, chromeId: string) => ({
    bookmarkId: `b-${chromeId}`,
    chromeId,
    url,
    rootTitle: "Bookmarks Bar" as BookmarkRootTitle,
  });

  it("counts tracking-param variants of the same url as duplicates", () => {
    const duplicates = countDuplicateAssignments([
      assignment("https://example.com/post?utm_source=x", "1"),
      assignment("HTTPS://EXAMPLE.com/post", "2"),
      assignment("https://other.com", "3"),
    ]);
    expect(duplicates).toBe(1);
  });
});

describe("renameNodeTitleInTree", () => {
  it("renames folder and bookmark nodes by id", () => {
    const tree = [
      {
        id: "1",
        title: "Old Folder",
        nodeType: "folder" as const,
        children: [
          {
            id: "2",
            title: "Old Bookmark",
            nodeType: "bookmark" as const,
            url: "https://google.com",
          },
        ],
      },
      {
        id: "3",
        title: "Root Folder",
        nodeType: "root" as const,
      },
    ];

    const result = renameNodeTitleInTree(tree, "2", "  New Bookmark  ");
    expect(result[0].children?.[0].title).toBe("New Bookmark");
    expect(result[0].children?.[0].originalTitle).toBe("Old Bookmark");

    const result2 = renameNodeTitleInTree(tree, "1", "New Folder");
    expect(result2[0].title).toBe("New Folder");
    expect(result2[0].originalTitle).toBeUndefined();
  });
});
