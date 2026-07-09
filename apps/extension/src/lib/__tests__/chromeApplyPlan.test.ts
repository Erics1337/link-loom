import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChromeBookmarkPlan,
  buildChromeBookmarkApplyPlan,
  loadActiveChromeApplyJournal,
  resumeChromeBookmarkApplyJournal,
  rollbackChromeBookmarkApplyJournal,
} from "../chromeApplyPlan";

type BookmarkRecord = {
  id: string;
  parentId: string;
  title: string;
  url?: string;
};

const createChromeBookmarksMock = () => {
  let nextId = 100;
  const storage = new Map<string, unknown>();
  const records = new Map<string, BookmarkRecord>([
    ["1", { id: "1", parentId: "0", title: "Bookmarks Bar" }],
    ["2", { id: "2", parentId: "0", title: "Other Bookmarks" }],
    ["3", { id: "3", parentId: "0", title: "Mobile Bookmarks" }],
    ["old-folder", { id: "old-folder", parentId: "1", title: "Old Folder" }],
    [
      "chrome-1",
      {
        id: "chrome-1",
        parentId: "old-folder",
        title: "Old Title",
        url: "https://example.com",
      },
    ],
  ]);

  const buildSubTree = (targetId: string): any => {
    const record = records.get(targetId);
    if (!record) return null;
    const children = Array.from(records.values())
      .filter((child) => child.parentId === targetId)
      .map((child) => buildSubTree(child.id))
      .filter(Boolean);
    return { ...record, index: 0, children };
  };

  return {
    records,
    api: {
      create: vi.fn(
        async ({
          parentId,
          title,
          url,
        }: {
          parentId: string;
          title: string;
          url?: string;
        }) => {
          const id = `created-${nextId++}`;
          records.set(id, { id, parentId, title, url });
          return records.get(id);
        },
      ),
      update: vi.fn(async (id: string, update: { title: string }) => {
        const record = records.get(id);
        if (!record) throw new Error(`Missing bookmark ${id}`);
        record.title = update.title;
        return record;
      }),
      move: vi.fn(async (id: string, move: { parentId: string }) => {
        const record = records.get(id);
        if (!record) throw new Error(`Missing bookmark ${id}`);
        record.parentId = move.parentId;
        return record;
      }),
      get: vi.fn(async (id: string) => {
        const record = records.get(id);
        return record ? [{ ...record, index: 0 }] : [];
      }),
      getSubTree: vi.fn(async (id: string) => {
        const node = buildSubTree(id);
        return node ? [node] : [];
      }),
      getChildren: vi.fn(async (parentId: string) =>
        Array.from(records.values()).filter(
          (record) => record.parentId === parentId,
        ),
      ),
      remove: vi.fn(async (id: string) => {
        records.delete(id);
      }),
      removeTree: vi.fn(async (id: string) => {
        const removeRecursive = (targetId: string) => {
          for (const child of Array.from(records.values()).filter(
            (record) => record.parentId === targetId,
          )) {
            removeRecursive(child.id);
          }
          records.delete(targetId);
        };
        removeRecursive(id);
      }),
    },
    storageApi: {
      get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.entries(values).forEach(([key, value]) =>
          storage.set(key, structuredClone(value)),
        );
      }),
      remove: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
};

const stubChromeBookmarks = () => {
  const chromeMock = createChromeBookmarksMock();
  vi.stubGlobal("chrome", {
    bookmarks: chromeMock.api,
    storage: { local: chromeMock.storageApi },
  });
  return chromeMock;
};

const bookmarkNode = (overrides: Record<string, unknown> = {}) => ({
  id: "bookmark-1",
  title: "Old Title",
  originalTitle: "Old Title",
  url: "https://example.com",
  chromeId: "chrome-1",
  nodeType: "bookmark" as const,
  ...overrides,
});

const docsFolderNode = (children = [bookmarkNode()]) => ({
  id: "folder-docs",
  title: "Docs",
  nodeType: "folder" as const,
  children,
});

const bookmarksBarRootNode = (children: any[]) => ({
  id: "root-Bookmarks Bar",
  title: "Bookmarks Bar",
  nodeType: "root" as const,
  rootTitle: "Bookmarks Bar" as const,
  children,
});

const buildBookmarksBarPlan = (children: any[]) =>
  buildChromeBookmarkApplyPlan([bookmarksBarRootNode(children)]);

const buildDocsPlan = (bookmarkOverrides: Record<string, unknown> = {}) =>
  buildBookmarksBarPlan([docsFolderNode([bookmarkNode(bookmarkOverrides)])]);

describe("chrome bookmark apply plan", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates folders, trims title updates, moves bookmarks, and clears replaced root children", async () => {
    const chromeMock = stubChromeBookmarks();

    const plan = await buildDocsPlan({
      title: " New Title ",
      rootTitle: "Bookmarks Bar",
    });
    const result = await applyChromeBookmarkPlan(plan);

    expect(plan.summary).toMatchObject({
      createFolderCount: 1,
      moveBookmarkCount: 1,
      renameBookmarkCount: 1,
      deleteRootChildCount: 1,
    });
    expect(result).toMatchObject({
      movedCount: 1,
      renamedCount: 1,
      deletedCount: 1,
      createdFolderCount: 1,
      skippedCount: 0,
      folderCreateFailures: 0,
      cleanupFailures: 0,
      shouldWarnAboutPartialApply: false,
    });
    expect(chromeMock.api.create).toHaveBeenCalledWith({
      parentId: "1",
      title: expect.stringContaining("[Link Loom apply"),
    });
    expect(chromeMock.api.update).toHaveBeenCalledWith("chrome-1", {
      title: "New Title",
    });
    expect(chromeMock.records.get("chrome-1")?.parentId).toMatch(/^created-/);
    expect(
      chromeMock.records.get(chromeMock.records.get("chrome-1")!.parentId)
        ?.title,
    ).toBe("Docs");
    expect(chromeMock.records.has("old-folder")).toBe(false);
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("reports the Chrome folder id created for each cluster-tagged folder node", async () => {
    stubChromeBookmarks();

    const plan = await buildBookmarksBarPlan([
      {
        id: "cluster-folder",
        title: "Docs",
        nodeType: "folder" as const,
        clusterId: "cluster-abc",
        children: [bookmarkNode()],
      },
    ]);
    const result = await applyChromeBookmarkPlan(plan);

    expect(result.folderChromeIdsByClusterId).toHaveLength(1);
    expect(result.folderChromeIdsByClusterId[0]).toMatchObject({
      clusterId: "cluster-abc",
    });
    expect(result.folderChromeIdsByClusterId[0].chromeFolderId).toMatch(
      /^created-/,
    );
  });

  it("warns, leaves existing folders in place, and keeps the journal when a bookmark cannot be moved", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.api.move.mockRejectedValueOnce(new Error("move failed"));

    const plan = await buildBookmarksBarPlan([
      bookmarkNode({ rootTitle: "Bookmarks Bar" }),
    ]);
    const result = await applyChromeBookmarkPlan(plan);

    expect(result).toMatchObject({
      movedCount: 0,
      skippedCount: 1,
      shouldWarnAboutPartialApply: true,
    });
    expect(chromeMock.records.has("old-folder")).toBe(true);
    expect(chromeMock.api.removeTree).not.toHaveBeenCalledWith("old-folder");
    expect(await loadActiveChromeApplyJournal()).not.toBeNull();
  });

  it("does not count bookmarks that are already in the target parent as moved", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.records.get("chrome-1")!.parentId = "1";

    const plan = await buildBookmarksBarPlan([
      bookmarkNode({ rootTitle: "Bookmarks Bar" }),
    ]);
    const result = await applyChromeBookmarkPlan(plan);

    expect(result.movedCount).toBe(0);
    expect(chromeMock.api.move).not.toHaveBeenCalled();
  });

  it("does not roll back pending move entries that never applied", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.api.move.mockRejectedValueOnce(new Error("move failed"));

    const plan = await buildBookmarksBarPlan([bookmarkNode()]);

    await applyChromeBookmarkPlan(plan);
    const journal = await loadActiveChromeApplyJournal();
    expect(
      journal?.entries.some(
        (entry: any) =>
          entry.type === "moveBookmark" && entry.status === "pending",
      ),
    ).toBe(true);
    chromeMock.records.get("chrome-1")!.parentId = "2";

    await rollbackChromeBookmarkApplyJournal(journal!);

    expect(chromeMock.records.get("chrome-1")?.parentId).toBe("2");
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("resumes folder creation by adopting a previously created marker folder", async () => {
    const chromeMock = stubChromeBookmarks();

    const plan = await buildDocsPlan();
    const folderPlanId = (plan.roots[0].children[0] as any).planId;
    chromeMock.records.set("created-marker", {
      id: "created-marker",
      parentId: "1",
      title: `[Link Loom apply ${plan.id}:${folderPlanId}] Docs`,
    });

    const result = await resumeChromeBookmarkApplyJournal({
      id: plan.id,
      plan,
      phase: "folders",
      createdFolderIdsByPlanId: {},
      entries: [
        {
          type: "createFolder",
          status: "pending",
          planId: folderPlanId,
          parentId: "1",
          title: "Docs",
        } as any,
      ],
      completed: false,
      updatedAt: new Date().toISOString(),
    });

    expect(result.shouldWarnAboutPartialApply).toBe(false);
    expect(chromeMock.records.get("created-marker")?.title).toBe("Docs");
    expect(chromeMock.records.get("chrome-1")?.parentId).toBe("created-marker");
    expect(chromeMock.api.create).not.toHaveBeenCalledWith({
      parentId: "1",
      title: expect.stringContaining("Link Loom apply"),
    });
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("does not delete a direct root bookmark after moving it into a planned folder", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.records.set("chrome-root", {
      id: "chrome-root",
      parentId: "1",
      title: "Root Bookmark",
      url: "https://root.example",
    });

    const plan = await buildDocsPlan({
      id: "bookmark-root",
      title: "Root Bookmark",
      originalTitle: "Root Bookmark",
      url: "https://root.example",
      chromeId: "chrome-root",
    });

    const result = await applyChromeBookmarkPlan(plan);

    expect(result.shouldWarnAboutPartialApply).toBe(false);
    expect(chromeMock.records.has("chrome-root")).toBe(true);
    expect(chromeMock.records.get("chrome-root")?.parentId).toMatch(
      /^created-/,
    );
    expect(chromeMock.api.remove).not.toHaveBeenCalledWith("chrome-root");
  });

  it("does not delete root children added after the user confirmed the apply plan", async () => {
    const chromeMock = stubChromeBookmarks();

    const plan = await buildDocsPlan();
    chromeMock.records.set("new-root-child", {
      id: "new-root-child",
      parentId: "1",
      title: "Added During Apply",
      url: "https://new.example",
    });

    const result = await applyChromeBookmarkPlan(plan);

    expect(result.shouldWarnAboutPartialApply).toBe(false);
    expect(chromeMock.records.has("new-root-child")).toBe(true);
    expect(chromeMock.records.has("old-folder")).toBe(false);
    expect(chromeMock.api.remove).not.toHaveBeenCalledWith("new-root-child");
  });

  it("resumes cleanup after one root child was already deleted and a later delete failed", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.records.set("stale-folder", {
      id: "stale-folder",
      parentId: "1",
      title: "Stale Folder",
    });
    chromeMock.api.removeTree
      .mockImplementationOnce(async (id: string) => {
        if (id === "stale-folder") {
          chromeMock.records.delete(id);
        }
      })
      .mockRejectedValueOnce(new Error("cleanup failed"));

    const plan = await buildDocsPlan();

    const firstResult = await applyChromeBookmarkPlan(plan);
    expect(firstResult.shouldWarnAboutPartialApply).toBe(true);
    expect(chromeMock.records.has("stale-folder")).toBe(false);
    expect(chromeMock.records.has("old-folder")).toBe(true);

    const journal = await loadActiveChromeApplyJournal();
    expect(journal).not.toBeNull();
    const resumeResult = await resumeChromeBookmarkApplyJournal(journal!);

    expect(resumeResult.shouldWarnAboutPartialApply).toBe(false);
    expect(chromeMock.records.has("old-folder")).toBe(false);
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("rolls back created folders, moves, renames, and root cleanup from the journal", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.api.removeTree.mockRejectedValueOnce(
      new Error("cleanup failed"),
    );

    const plan = await buildDocsPlan({ title: "New Title" });

    const result = await applyChromeBookmarkPlan(plan);
    expect(result.shouldWarnAboutPartialApply).toBe(true);

    const journal = await loadActiveChromeApplyJournal();
    expect(journal).not.toBeNull();
    await rollbackChromeBookmarkApplyJournal(journal!);

    expect(chromeMock.records.get("chrome-1")).toMatchObject({
      parentId: "old-folder",
      title: "Old Title",
    });
    expect(
      Array.from(chromeMock.records.values()).some(
        (record) => record.title === "Docs",
      ),
    ).toBe(false);
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("rescues un-planned root bookmarks into Unorganized instead of deleting them", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.records.set("stale-bookmark", {
      id: "stale-bookmark",
      parentId: "1",
      title: "Stale Bookmark",
      url: "https://stale.example",
    });

    const plan = await buildDocsPlan();
    const result = await applyChromeBookmarkPlan(plan);

    expect(result.rescuedCount).toBe(1);
    const rescued = chromeMock.records.get("stale-bookmark");
    expect(rescued).toBeDefined();
    const rescueFolder = chromeMock.records.get(rescued!.parentId);
    expect(rescueFolder).toMatchObject({
      parentId: "1",
      title: "Unorganized",
    });
    expect(chromeMock.api.remove).not.toHaveBeenCalledWith("stale-bookmark");
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("rescues bookmarks still inside a deleted folder into Unorganized", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.records.set("orphan-1", {
      id: "orphan-1",
      parentId: "old-folder",
      title: "Orphaned Bookmark",
      url: "https://orphan.example",
    });

    const plan = await buildDocsPlan();
    const result = await applyChromeBookmarkPlan(plan);

    expect(result.rescuedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(chromeMock.records.has("old-folder")).toBe(false);
    const orphan = chromeMock.records.get("orphan-1");
    expect(orphan).toBeDefined();
    expect(chromeMock.records.get(orphan!.parentId)).toMatchObject({
      parentId: "1",
      title: "Unorganized",
    });
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("restores deleted folder subtrees and rescued bookmarks on rollback", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.records.set("stale-folder", {
      id: "stale-folder",
      parentId: "1",
      title: "Stale Folder",
    });
    chromeMock.records.set("nested-folder", {
      id: "nested-folder",
      parentId: "old-folder",
      title: "Nested",
    });
    chromeMock.records.set("orphan-1", {
      id: "orphan-1",
      parentId: "nested-folder",
      title: "Orphaned Bookmark",
      url: "https://orphan.example",
    });
    // First cleanup delete (stale-folder) fails so the journal survives.
    chromeMock.api.removeTree.mockRejectedValueOnce(
      new Error("cleanup failed"),
    );

    const plan = await buildDocsPlan();
    const result = await applyChromeBookmarkPlan(plan);

    expect(result.rescuedCount).toBe(1);
    expect(chromeMock.records.has("old-folder")).toBe(false);
    expect(chromeMock.records.has("nested-folder")).toBe(false);
    expect(chromeMock.records.has("orphan-1")).toBe(true);

    const journal = await loadActiveChromeApplyJournal();
    expect(journal).not.toBeNull();
    await rollbackChromeBookmarkApplyJournal(journal!);

    const records = Array.from(chromeMock.records.values());
    const restoredOldFolder = records.find(
      (record) => record.title === "Old Folder" && record.parentId === "1",
    );
    expect(restoredOldFolder).toBeDefined();
    const restoredNested = records.find(
      (record) =>
        record.title === "Nested" && record.parentId === restoredOldFolder!.id,
    );
    expect(restoredNested).toBeDefined();
    expect(chromeMock.records.get("orphan-1")?.parentId).toBe(
      restoredNested!.id,
    );
    expect(chromeMock.records.get("chrome-1")?.parentId).toBe(
      restoredOldFolder!.id,
    );
    expect(records.some((record) => record.title === "Unorganized")).toBe(
      false,
    );
    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("rejects starting a new apply while an active journal exists", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.api.removeTree.mockRejectedValueOnce(
      new Error("cleanup failed"),
    );

    const plan = await buildDocsPlan();
    await applyChromeBookmarkPlan(plan);

    expect(await loadActiveChromeApplyJournal()).not.toBeNull();
    await expect(applyChromeBookmarkPlan(plan)).rejects.toThrow(
      "An unfinished bookmark apply journal is already active.",
    );
  });

  it("skips removing a created folder that still contains bookmarks", async () => {
    const chromeMock = stubChromeBookmarks();
    const plan = await buildDocsPlan();
    const folderPlanId = (plan.roots[0].children[0] as { planId: string })
      .planId;
    const folderId = "created-folder";

    chromeMock.records.set(folderId, {
      id: folderId,
      parentId: "1",
      title: "Docs",
    });
    chromeMock.records.get("chrome-1")!.parentId = folderId;
    chromeMock.records.set("untracked-bookmark", {
      id: "untracked-bookmark",
      parentId: folderId,
      title: "Manual Bookmark",
      url: "https://manual.example",
    });

    await rollbackChromeBookmarkApplyJournal({
      id: plan.id,
      plan,
      phase: "rollback",
      createdFolderIdsByPlanId: { [folderPlanId]: folderId },
      entries: [
        {
          type: "createFolder",
          status: "applied",
          planId: folderPlanId,
          chromeId: folderId,
          parentId: "1",
          title: "Docs",
        },
        {
          type: "moveBookmark",
          status: "pending",
          chromeId: "chrome-1",
          previousParentId: "old-folder",
          previousIndex: 0,
          nextParentId: folderId,
        },
      ],
      completed: false,
      updatedAt: new Date().toISOString(),
    });

    expect(chromeMock.records.has("chrome-1")).toBe(true);
    expect(chromeMock.records.has(folderId)).toBe(true);
    expect(chromeMock.api.removeTree).not.toHaveBeenCalledWith(folderId);
  });

  it("continues rollback when manually edited entries are already missing", async () => {
    const chromeMock = stubChromeBookmarks();
    chromeMock.api.removeTree.mockRejectedValueOnce(
      new Error("cleanup failed"),
    );

    const plan = await buildDocsPlan({ title: "New Title" });

    await applyChromeBookmarkPlan(plan);
    const journal = await loadActiveChromeApplyJournal();
    expect(journal).not.toBeNull();
    const createdFolderIds = Object.values(journal!.createdFolderIdsByPlanId);
    createdFolderIds.forEach((id) => chromeMock.records.delete(id));
    chromeMock.records.delete("chrome-1");

    await rollbackChromeBookmarkApplyJournal(journal!);

    expect(await loadActiveChromeApplyJournal()).toBeNull();
  });

  it("does not reuse a rescue folder if it is in deleteTargets", async () => {
    const chromeMock = stubChromeBookmarks();
    // Add an existing 'Unorganized' folder
    chromeMock.records.set("existing-unorganized", {
      id: "existing-unorganized",
      parentId: "1",
      title: "Unorganized",
    });
    // Add an unplanned root bookmark that needs rescuing
    chromeMock.records.set("stale-bookmark", {
      id: "stale-bookmark",
      parentId: "1",
      title: "Stale Bookmark",
      url: "https://stale.example",
    });

    const plan = await buildDocsPlan();

    const result = await applyChromeBookmarkPlan(plan);
    expect(result.rescuedCount).toBe(1);

    // It should NOT have rescued the bookmark to 'existing-unorganized'
    const rescuedBookmark = chromeMock.records.get("stale-bookmark");
    expect(rescuedBookmark).toBeDefined();
    expect(rescuedBookmark!.parentId).not.toBe("existing-unorganized");

    // It should have created a new folder and recorded it in createdFolderIdsByPlanId
    const newRescueFolderId = rescuedBookmark!.parentId;
    expect(newRescueFolderId).toMatch(/^created-/);

    // The original 'existing-unorganized' should have been deleted
    expect(chromeMock.records.has("existing-unorganized")).toBe(false);
  });

  it("reconciles pending updateBookmark and moveBookmark entries when they already reflect in Chrome on resume", async () => {
    const chromeMock = stubChromeBookmarks();
    const plan = await buildDocsPlan();

    // Create a journal with pending entries that are already applied in Chrome
    // We set up Chrome records to match the 'next' state
    chromeMock.records.get("chrome-1")!.title = "Docs"; // nextTitle
    chromeMock.records.set("created-folder-id", {
      id: "created-folder-id",
      parentId: "1",
      title: "Docs",
    });
    chromeMock.records.get("chrome-1")!.parentId = "created-folder-id"; // nextParentId

    const journal = {
      id: plan.id,
      plan,
      phase: "bookmarks" as const,
      createdFolderIdsByPlanId: {
        [`root-Bookmarks Bar-0`]: "created-folder-id",
      },
      entries: [
        {
          type: "updateBookmark" as const,
          status: "pending" as const,
          chromeId: "chrome-1",
          previousTitle: "Old Title",
          nextTitle: "Docs",
        },
        {
          type: "moveBookmark" as const,
          status: "pending" as const,
          chromeId: "chrome-1",
          previousParentId: "old-folder",
          nextParentId: "created-folder-id",
        },
      ],
      completed: false,
      updatedAt: new Date().toISOString(),
    };

    const result = await resumeChromeBookmarkApplyJournal(journal);
    expect(result.shouldWarnAboutPartialApply).toBe(false);

    // Check that pending entries were reconciled and marked applied
    expect(journal.entries[0].status).toBe("applied");
    expect(journal.entries[1].status).toBe("applied");
  });

  it("reconciles pending entries and rolls them back during rollback", async () => {
    const chromeMock = stubChromeBookmarks();
    const plan = await buildDocsPlan();

    // Setup: Chrome already has the new title and moved parent, but journal says it is pending
    chromeMock.records.get("chrome-1")!.title = "Docs";
    chromeMock.records.set("created-folder-id", {
      id: "created-folder-id",
      parentId: "1",
      title: "Docs",
    });
    chromeMock.records.get("chrome-1")!.parentId = "created-folder-id";

    const journal = {
      id: plan.id,
      plan,
      phase: "rollback" as const,
      createdFolderIdsByPlanId: {
        [`root-Bookmarks Bar-0`]: "created-folder-id",
      },
      entries: [
        {
          type: "updateBookmark" as const,
          status: "pending" as const,
          chromeId: "chrome-1",
          previousTitle: "Old Title",
          nextTitle: "Docs",
        },
        {
          type: "moveBookmark" as const,
          status: "pending" as const,
          chromeId: "chrome-1",
          previousParentId: "old-folder",
          nextParentId: "created-folder-id",
        },
      ],
      completed: false,
      updatedAt: new Date().toISOString(),
    };

    await rollbackChromeBookmarkApplyJournal(journal);

    // Reconciled entries should have been rolled back to their previous states
    const bookmark = chromeMock.records.get("chrome-1");
    expect(bookmark).toBeDefined();
    expect(bookmark!.title).toBe("Old Title");
    expect(bookmark!.parentId).toBe("old-folder");
    expect(journal.entries[0].status).toBe("applied");
    expect(journal.entries[1].status).toBe("applied");
  });

  it("prevents concurrent executions and rejects the second call immediately", async () => {
    stubChromeBookmarks();
    const plan1 = await buildDocsPlan();
    const plan2 = await buildDocsPlan();

    // Start first apply
    const promise1 = applyChromeBookmarkPlan(plan1);

    // Start second apply concurrently in the same tick
    const promise2 = applyChromeBookmarkPlan(plan2);

    await expect(promise2).rejects.toThrow(
      "A bookmark apply is already in progress.",
    );

    // Wait for first one to finish
    await promise1;
  });

  it("renames a recovered marker folder to user-facing title on resume when folder ID is already in createdFolderIdsByPlanId", async () => {
    const chromeMock = stubChromeBookmarks();

    const plan = await buildDocsPlan();
    const folderPlanId = (plan.roots[0].children[0] as any).planId;
    const folderId = "created-marker";
    chromeMock.records.set(folderId, {
      id: folderId,
      parentId: "1",
      title: `[Link Loom apply ${plan.id}:${folderPlanId}] Docs`,
    });

    const result = await resumeChromeBookmarkApplyJournal({
      id: plan.id,
      plan,
      phase: "folders",
      createdFolderIdsByPlanId: {
        [folderPlanId]: folderId,
      },
      entries: [
        {
          type: "createFolder",
          status: "applied",
          planId: folderPlanId,
          chromeId: folderId,
          parentId: "1",
          title: "Docs",
        } as any,
      ],
      completed: false,
      updatedAt: new Date().toISOString(),
    });

    expect(result.shouldWarnAboutPartialApply).toBe(false);
    expect(chromeMock.records.get(folderId)?.title).toBe("Docs");
  });
});
