import { WeavingProgress } from "./structureClient";

export type {
  ScannedBookmark,
  BookmarkRootSnapshot,
} from "./bookmarkRootSnapshot";
export {
  buildBookmarkRootSnapshot,
  collectScannedBookmarks,
} from "./bookmarkRootSnapshot";
export {
  persistOverflowBookmarks,
  loadPersistedOverflowBookmarks,
  clearPersistedOverflowBookmarks,
  savePreOrganizeBackup,
} from "./processingSessionStorage";

export const createEmptyProgress = (): WeavingProgress => ({
  pending: 0,
  pendingRaw: 0,
  enriched: 0,
  embedded: 0,
  errored: 0,
  processing: 0,
  remainingToAssign: 0,
  clusters: 0,
  assigned: 0,
  total: 0,
  isIngesting: false,
  ingestProcessed: 0,
  ingestTotal: 0,
  isClusteringActive: false,
});
