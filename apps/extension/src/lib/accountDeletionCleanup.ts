import { clearStructureVersions } from "./backupClient";
import { clearChromeApplyJournal } from "./chromeApplyPlan";
import { SESSION_STORAGE_KEY } from "./extensionAuthSession";
import {
  clearAllPersistedOverflowBookmarks,
  clearPreOrganizeBackup,
} from "./processingSessionStorage";

const DEVICE_ID_STORAGE_KEY = "deviceId";

export const clearLocalAccountData = async () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;

  await Promise.all([
    clearAllPersistedOverflowBookmarks(),
    clearPreOrganizeBackup(),
    clearStructureVersions(),
    clearChromeApplyJournal(),
    chrome.storage.local.remove([DEVICE_ID_STORAGE_KEY, SESSION_STORAGE_KEY]),
  ]);
};
