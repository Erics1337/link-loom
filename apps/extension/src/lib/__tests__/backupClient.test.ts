import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookmarkNode } from "../../components/BookmarkTree";
import {
  saveStructureVersion,
  loadStructureVersions,
  deleteStructureVersion,
  STRUCTURE_VERSIONS_STORAGE_KEY,
} from "../backupClient";

describe("backupClient", () => {
  let stored: Record<string, any>;
  let mockStore: Map<string, any>;
  let shouldFailSet: boolean;

  beforeEach(() => {
    stored = {};
    mockStore = new Map();
    shouldFailSet = false;

    // Reset global chrome mock
    vi.stubGlobal("chrome", undefined);
    
    // Setup Chrome storage mock
    const storage = {
      get: vi.fn(async (keys: string[]) => {
        return Object.fromEntries(keys.map((key) => [key, stored[key]]));
      }),
      set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
        if (shouldFailSet) {
          shouldFailSet = false;
          (chrome.runtime as any).lastError = { message: "Quota exceeded" };
          if (callback) callback();
          delete (chrome.runtime as any).lastError;
          return Promise.resolve();
        }
        Object.assign(stored, items);
        if (callback) callback();
        return Promise.resolve();
      }),
      remove: vi.fn(async (key: string) => {
        delete stored[key];
      }),
    };
    
    vi.stubGlobal("chrome", {
      storage: { local: storage },
      runtime: {},
    });

    // Mock IndexedDB
    const mockIndexedDB = {
      open: () => {
        const request: any = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          result: {
            objectStoreNames: {
              contains: () => true,
            },
            transaction: (_storeName: string, _mode: string) => {
              return {
                objectStore: () => {
                  return {
                    get: (key: string) => {
                      const req: any = { onsuccess: null, onerror: null };
                      setTimeout(() => {
                        req.result = mockStore.get(key);
                        if (req.onsuccess) req.onsuccess();
                      }, 0);
                      return req;
                    },
                    put: (value: any, key: string) => {
                      const req: any = { onsuccess: null, onerror: null };
                      setTimeout(() => {
                        mockStore.set(key, value);
                        if (req.onsuccess) req.onsuccess();
                      }, 0);
                      return req;
                    },
                    delete: (key: string) => {
                      const req: any = { onsuccess: null, onerror: null };
                      setTimeout(() => {
                        mockStore.delete(key);
                        if (req.onsuccess) req.onsuccess();
                      }, 0);
                      return req;
                    },
                    clear: () => {
                      const req: any = { onsuccess: null, onerror: null };
                      setTimeout(() => {
                        mockStore.clear();
                        if (req.onsuccess) req.onsuccess();
                      }, 0);
                      return req;
                    },
                  };
                },
              };
            },
          },
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess();
        }, 0);
        return request;
      },
    };

    vi.stubGlobal("indexedDB", mockIndexedDB);
    vi.stubGlobal("crypto", {
      randomUUID: () => Math.random().toString(36).substring(2, 15),
    });
  });

  it("saves, loads, deletes, and clears structure versions, moving clusters to IndexedDB", async () => {
    const clusters: BookmarkNode[] = [
      { id: "1", title: "Test Bookmark", nodeType: "bookmark", url: "https://test.com" }
    ];
    const stats = { duplicates: 0, deadLinks: 0 };

    const snapshot = await saveStructureVersion(clusters, stats);
    expect(snapshot.id).toBeDefined();
    expect(snapshot.clusters).toEqual(clusters);

    // Verify stored local storage metadata (should have empty clusters)
    const localStored = stored[STRUCTURE_VERSIONS_STORAGE_KEY];
    expect(localStored).toHaveLength(1);
    expect(localStored[0].id).toBe(snapshot.id);
    expect(localStored[0].clusters).toEqual([]);

    // Verify IndexedDB has the clusters
    expect(mockStore.get(snapshot.id)).toEqual(clusters);

    // Load versions and verify clusters are populated back
    const loaded = await loadStructureVersions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(snapshot.id);
    expect(loaded[0].clusters).toEqual(clusters);

    // Delete and verify it gets cleared from local storage and IndexedDB
    await deleteStructureVersion(snapshot.id);
    expect(stored[STRUCTURE_VERSIONS_STORAGE_KEY]).toHaveLength(0);
    expect(mockStore.has(snapshot.id)).toBe(false);
  });

  it("prunes oldest versions and deletes their clusters when exceeding limit", async () => {
    const stats = { duplicates: 0, deadLinks: 0 };
    const savedIds: string[] = [];

    // Save 21 versions (limit is 20)
    for (let i = 0; i < 21; i++) {
      const clusters: BookmarkNode[] = [
        { id: `node-${i}`, title: `Node ${i}`, nodeType: "bookmark" }
      ];
      const snapshot = await saveStructureVersion(clusters, stats);
      savedIds.push(snapshot.id);
    }

    // Load versions, should only have 20 versions
    const loaded = await loadStructureVersions();
    expect(loaded).toHaveLength(20);

    // The oldest version (savedIds[0]) should have been pruned
    expect(loaded.find((v) => v.id === savedIds[0])).toBeUndefined();
    // Its IndexedDB record should have been deleted
    expect(mockStore.has(savedIds[0])).toBe(false);

    // The rest of the 20 versions should exist in IndexedDB
    for (let i = 1; i < 21; i++) {
      expect(mockStore.has(savedIds[i])).toBe(true);
    }
  });

  it("handles quota limits by progressively pruning oldest versions in chrome.storage.local", async () => {
    const stats = { duplicates: 0, deadLinks: 0 };
    const id1 = (await saveStructureVersion([{ id: "1", title: "One" }], stats)).id;
    const id2 = (await saveStructureVersion([{ id: "2", title: "Two" }], stats)).id;

    expect(mockStore.has(id1)).toBe(true);
    expect(mockStore.has(id2)).toBe(true);
    expect(stored[STRUCTURE_VERSIONS_STORAGE_KEY]).toHaveLength(2);

    // Trigger quota failure on next save
    shouldFailSet = true;
    const id3 = (await saveStructureVersion([{ id: "3", title: "Three" }], stats)).id;

    // The oldest version (id1) should have been pruned to fit the storage quota
    expect(stored[STRUCTURE_VERSIONS_STORAGE_KEY]).toHaveLength(2);
    expect(stored[STRUCTURE_VERSIONS_STORAGE_KEY][0].id).toBe(id3);
    expect(stored[STRUCTURE_VERSIONS_STORAGE_KEY][1].id).toBe(id2);

    expect(mockStore.has(id3)).toBe(true);
    expect(mockStore.has(id2)).toBe(true);
    expect(mockStore.has(id1)).toBe(false); // id1 clusters deleted from IndexedDB
  });
});
