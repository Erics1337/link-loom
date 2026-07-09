import { ScannedBookmark } from "./bookmarkRootSnapshot";

export const OVERFLOW_BOOKMARKS_STORAGE_KEY = "bookmarkWeaverOverflowBookmarks";
// Safety Backup storage keeps the legacy key so existing local Safety Backup data remains readable.
export const PRE_ORGANIZE_BACKUP_KEY = "preOrganizeBackup";

const getOverflowStorageKey = (userId: string) =>
  `${OVERFLOW_BOOKMARKS_STORAGE_KEY}:${userId}`;

export const persistOverflowBookmarks = async (
  userId: string,
  overflowBookmarks: ScannedBookmark[],
) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !userId)
    return;
  await chrome.storage.local.set({
    [getOverflowStorageKey(userId)]: overflowBookmarks,
  });
};

export const loadPersistedOverflowBookmarks = async (userId: string) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !userId) {
    return [] as ScannedBookmark[];
  }

  const storageResult = await chrome.storage.local.get([
    getOverflowStorageKey(userId),
  ]);
  const stored = storageResult[getOverflowStorageKey(userId)];
  return Array.isArray(stored) ? (stored as ScannedBookmark[]) : [];
};

export const clearPersistedOverflowBookmarks = async (userId: string) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !userId)
    return;
  await chrome.storage.local.remove(getOverflowStorageKey(userId));
};

export const clearPreOrganizeBackup = async () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.remove(PRE_ORGANIZE_BACKUP_KEY);
};

export const clearAllPersistedOverflowBookmarks = async () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const stored = await chrome.storage.local.get(null);
  const keys = Object.keys(stored).filter(
    (key) =>
      key === OVERFLOW_BOOKMARKS_STORAGE_KEY ||
      key.startsWith(`${OVERFLOW_BOOKMARKS_STORAGE_KEY}:`),
  );
  if (keys.length) {
    await chrome.storage.local.remove(keys);
  }
};

export const savePreOrganizeBackup = async (tree: any[]) => {
  const clonedTree =
    typeof structuredClone === "function"
      ? structuredClone(tree)
      : JSON.parse(JSON.stringify(tree));
  const backup = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    tree: clonedTree,
  };

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [PRE_ORGANIZE_BACKUP_KEY]: backup });
    } catch (error) {
      console.error("Failed to save safety backup to chrome.storage.local:", error);
      throw new Error(
        `Safety backup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return backup;
};
