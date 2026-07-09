import { BookmarkNode } from "../components/BookmarkTree";
import { BookmarkStats, summarizeStructure } from "./bookmarkStructure";

export type BookmarkStructureVersion = {
  id: string;
  createdAt: string;
  clusters: BookmarkNode[];
  stats: BookmarkStats;
  summary: {
    folders: number;
    bookmarks: number;
  };
};

export type CloudSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  summary: {
    folders: number;
    bookmarks: number;
  };
};

export const STRUCTURE_VERSIONS_STORAGE_KEY = "bookmarkStructureVersions";
const MAX_STRUCTURE_VERSIONS = 20;

const DB_NAME = "LinkLoomBackupDB";
const DB_VERSION = 1;
const STORE_NAME = "bookmarkClusters";

const getDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error || new Error("Failed to open IndexedDB"));
    };
  });
};

const getClustersFromIndexedDB = (
  id: string,
): Promise<BookmarkNode[] | null> => {
  return getDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        resolve((request.result as BookmarkNode[]) || null);
      };
      request.onerror = () => {
        reject(
          request.error || new Error(`Failed to get clusters for ID: ${id}`),
        );
      };
    });
  });
};

const saveClustersToIndexedDB = (
  id: string,
  clusters: BookmarkNode[],
): Promise<void> => {
  return getDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(clusters, id);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(
          request.error || new Error(`Failed to save clusters for ID: ${id}`),
        );
      };
    });
  });
};

const deleteClustersFromIndexedDB = (id: string): Promise<void> => {
  return getDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(
          request.error || new Error(`Failed to delete clusters for ID: ${id}`),
        );
      };
    });
  });
};

const clearClustersFromIndexedDB = (): Promise<void> => {
  return getDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error || new Error("Failed to clear clusters database"));
      };
    });
  });
};

async function saveVersionsToStorage(
  versions: BookmarkStructureVersion[],
): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }

  // Ensure clusters are not stored in chrome.storage.local
  let nextVersions = versions.map((v) => ({
    ...v,
    clusters: [],
  }));

  if (nextVersions.length === 0) {
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set(
        {
          [STRUCTURE_VERSIONS_STORAGE_KEY]: [],
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        },
      );
    });
    return;
  }

  while (nextVersions.length > 0) {
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set(
          {
            [STRUCTURE_VERSIONS_STORAGE_KEY]: nextVersions,
          },
          () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          },
        );
      });
      return; // Success!
    } catch (error) {
      console.warn(
        `[BACKUP] Failed to save versions to chrome.storage.local. Attempting to prune oldest version. Error:`,
        error,
      );
      const removedVersion = nextVersions.pop();
      if (removedVersion) {
        try {
          await deleteClustersFromIndexedDB(removedVersion.id);
        } catch (dbError) {
          console.error(
            `[BACKUP] Failed to delete pruned clusters from IndexedDB for ${removedVersion.id}:`,
            dbError,
          );
        }
      }
    }
  }
}

const isCloudSnapshotSummary = (
  value: unknown,
): value is CloudSnapshot["summary"] =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CloudSnapshot["summary"]).folders === "number" &&
  typeof (value as CloudSnapshot["summary"]).bookmarks === "number";

export const saveStructureVersion = async (
  clusters: BookmarkNode[],
  stats: BookmarkStats,
) => {
  if (!clusters.length) {
    throw new Error("No bookmark structure is available to save yet.");
  }

  const snapshot: BookmarkStructureVersion = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    clusters: JSON.parse(JSON.stringify(clusters)) as BookmarkNode[],
    stats: { ...stats },
    summary: summarizeStructure(clusters),
  };

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return snapshot;
  }

  // Save the clusters to IndexedDB first
  try {
    await saveClustersToIndexedDB(snapshot.id, snapshot.clusters);
  } catch (dbError) {
    console.error(
      `[BACKUP] Failed to save clusters to IndexedDB for ${snapshot.id}:`,
      dbError,
    );
  }

  const storageResult = await chrome.storage.local.get([
    STRUCTURE_VERSIONS_STORAGE_KEY,
  ]);
  const existingVersions = Array.isArray(
    storageResult[STRUCTURE_VERSIONS_STORAGE_KEY],
  )
    ? (storageResult[
        STRUCTURE_VERSIONS_STORAGE_KEY
      ] as BookmarkStructureVersion[])
    : [];

  const allVersions = [snapshot, ...existingVersions];
  const nextVersions = allVersions.slice(0, MAX_STRUCTURE_VERSIONS);
  const prunedVersions = allVersions.slice(MAX_STRUCTURE_VERSIONS);

  // Clean up IndexedDB for pruned versions
  for (const v of prunedVersions) {
    try {
      await deleteClustersFromIndexedDB(v.id);
    } catch (dbError) {
      console.error(
        `[BACKUP] Failed to delete pruned clusters from IndexedDB for ${v.id}:`,
        dbError,
      );
    }
  }

  await saveVersionsToStorage(nextVersions);
  return snapshot;
};

export const loadStructureVersions = async () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return [] as BookmarkStructureVersion[];
  }

  const storageResult = await chrome.storage.local.get([
    STRUCTURE_VERSIONS_STORAGE_KEY,
  ]);
  const versions = Array.isArray(storageResult[STRUCTURE_VERSIONS_STORAGE_KEY])
    ? (storageResult[
        STRUCTURE_VERSIONS_STORAGE_KEY
      ] as BookmarkStructureVersion[])
    : [];

  const populatedVersions = await Promise.all(
    versions.map(async (version) => {
      if (!version.clusters || version.clusters.length === 0) {
        try {
          const clusters = await getClustersFromIndexedDB(version.id);
          return {
            ...version,
            clusters: clusters || [],
          };
        } catch (dbError) {
          console.error(
            `[BACKUP] Failed to load clusters from IndexedDB for ${version.id}:`,
            dbError,
          );
          return {
            ...version,
            clusters: [],
          };
        }
      }
      return version;
    }),
  );

  return populatedVersions;
};

export const deleteStructureVersion = async (versionId: string) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }

  try {
    await deleteClustersFromIndexedDB(versionId);
  } catch (dbError) {
    console.error(
      `[BACKUP] Failed to delete clusters from IndexedDB for ${versionId}:`,
      dbError,
    );
  }

  const storageResult = await chrome.storage.local.get([
    STRUCTURE_VERSIONS_STORAGE_KEY,
  ]);
  const versions = Array.isArray(storageResult[STRUCTURE_VERSIONS_STORAGE_KEY])
    ? (storageResult[
        STRUCTURE_VERSIONS_STORAGE_KEY
      ] as BookmarkStructureVersion[])
    : [];
  const remaining = versions.filter((item) => item.id !== versionId);
  await saveVersionsToStorage(remaining);
};

export const clearStructureVersions = async () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }

  try {
    await clearClustersFromIndexedDB();
  } catch (dbError) {
    console.error("[BACKUP] Failed to clear clusters from IndexedDB:", dbError);
  }

  await chrome.storage.local.remove(STRUCTURE_VERSIONS_STORAGE_KEY);
};

type CloudSnapshotClientOptions = {
  backendUrl: string;
  accountUserId?: string | null;
  canSaveCloudSnapshots: boolean;
  buildAuthHeaders: () => Record<string, string>;
  getAuthHeaders: () => Record<string, string>;
};

export class CloudSnapshotClient {
  constructor(private readonly options: CloudSnapshotClientOptions) {}

  private async resolveSavedCloudSnapshotSummary(
    responseData: unknown,
    snapshotId: string,
    clusters?: BookmarkNode[],
  ): Promise<CloudSnapshot["summary"]> {
    const responseSummary = (responseData as { summary?: unknown })?.summary;
    if (isCloudSnapshotSummary(responseSummary)) {
      return responseSummary;
    }

    if (clusters !== undefined) {
      return summarizeStructure(clusters);
    }

    const snapshots = await this.loadCloudSnapshots();
    const saved = snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (saved) {
      return saved.summary;
    }

    return { folders: 0, bookmarks: 0 };
  }

  async loadCloudSnapshots() {
    if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
      return [] as CloudSnapshot[];
    }

    try {
      const response = await fetch(
        `${this.options.backendUrl}/backups/${this.options.accountUserId}`,
        {
          headers: this.options.getAuthHeaders(),
        },
      );
      if (!response.ok) throw new Error("Failed to load Cloud Snapshots");
      const data = await response.json();
      return data.backups as CloudSnapshot[];
    } catch (error) {
      console.error("[CLOUD SNAPSHOTS] Fetch error:", error);
      return [] as CloudSnapshot[];
    }
  }

  async saveCurrentCloudSnapshot(
    customName?: string,
    clusters?: BookmarkNode[],
  ) {
    if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
      throw new Error("Create a free account to save Cloud Snapshots.");
    }

    const name =
      customName || `Cloud Snapshot ${new Date().toLocaleDateString()}`;
    const response = await fetch(
      `${this.options.backendUrl}/backups/${this.options.accountUserId}`,
      {
        method: "POST",
        headers: this.options.buildAuthHeaders(),
        body: JSON.stringify({ name }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to save Cloud Snapshot");
    }

    const data = await response.json().catch(() => ({}));
    const snapshotId =
      typeof data?.snapshotId === "string" ? data.snapshotId.trim() : "";
    if (!snapshotId) {
      throw new Error(
        "Cloud Snapshot save succeeded but the server returned no snapshot id.",
      );
    }
    const createdAt =
      typeof data?.createdAt === "string" && data.createdAt
        ? data.createdAt
        : new Date().toISOString();
    const summary = await this.resolveSavedCloudSnapshotSummary(
      data,
      snapshotId,
      clusters,
    );

    return {
      id: snapshotId,
      name,
      createdAt,
      summary,
    };
  }

  async deleteCloudSnapshot(snapshotId: string) {
    if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
      throw new Error("Create a free account to manage Cloud Snapshots.");
    }

    const response = await fetch(
      `${this.options.backendUrl}/backups/${this.options.accountUserId}/${snapshotId}`,
      {
        method: "DELETE",
        headers: this.options.getAuthHeaders(),
      },
    );

    if (!response.ok) throw new Error("Failed to delete Cloud Snapshot");
  }

  async restoreCloudSnapshot(snapshotId: string) {
    if (!this.options.accountUserId || !this.options.canSaveCloudSnapshots) {
      throw new Error("Create a free account to restore Cloud Snapshots.");
    }

    const response = await fetch(
      `${this.options.backendUrl}/backups/${this.options.accountUserId}/${snapshotId}/restore`,
      {
        method: "POST",
        headers: this.options.getAuthHeaders(),
      },
    );

    if (!response.ok) throw new Error("Failed to restore Cloud Snapshot");
  }
}
