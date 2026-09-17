import {
  AUTH_COMPLETE_MESSAGE,
  AUTH_ERROR_MESSAGE,
  AUTH_ERROR_STORAGE_KEY,
  buildStoredSessionFromAuthMessage,
  ExtensionAuthMessage,
  PENDING_AUTH_NONCE_STORAGE_KEY,
  SESSION_STORAGE_KEY,
} from "./lib/extensionAuthSession";

console.log("Link Loom background script loaded");

const ALLOWED_EXTERNAL_ORIGINS = new Set([
  "https://linkloom.org",
  "http://localhost:3000",
]);

const isAllowedExternalOrigin = (senderUrl?: string) => {
  if (!senderUrl) return false;

  try {
    const { origin, hostname } = new URL(senderUrl);
    return (
      ALLOWED_EXTERNAL_ORIGINS.has(origin) ||
      (origin.startsWith("https://") && hostname.endsWith(".linkloom.org"))
    );
  } catch {
    return false;
  }
};

const notifyExtensionPages = (payload: Record<string, unknown>) => {
  chrome.runtime.sendMessage(payload).catch(() => {
    // Popup or side panel may be closed while auth completes in a tab.
  });
};

const getPendingAuthNonce = () =>
  new Promise<string | null>((resolve) => {
    chrome.storage.local.get([PENDING_AUTH_NONCE_STORAGE_KEY], (result) => {
      const nonce = result[PENDING_AUTH_NONCE_STORAGE_KEY];
      resolve(typeof nonce === "string" ? nonce : null);
    });
  });

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    const authMessage = message as ExtensionAuthMessage | undefined;
    if (!authMessage?.type) {
      return;
    }

    if (!isAllowedExternalOrigin(sender.url)) {
      sendResponse({ success: false, error: "unauthorized_origin" });
      return;
    }

    if (authMessage.type === "LINK_LOOM_EXTENSION_AUTH") {
      void (async () => {
        const pendingNonce = await getPendingAuthNonce();

        if (!pendingNonce || authMessage.nonce !== pendingNonce) {
          sendResponse({ success: false, error: "invalid_auth_nonce" });
          return;
        }

        const session = buildStoredSessionFromAuthMessage(authMessage);

        chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session, [AUTH_ERROR_STORAGE_KEY]: "" }, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: "session_storage_failed" });
            return;
          }
          chrome.storage.local.remove([PENDING_AUTH_NONCE_STORAGE_KEY], () => {
            notifyExtensionPages({
              type: AUTH_COMPLETE_MESSAGE,
              session,
            });

            if (sender.tab?.id !== undefined) {
              chrome.tabs.remove(sender.tab.id).catch(() => {});
            }

            sendResponse({ success: true });
          });
        });
      })();

      return true;
    }

    if (authMessage.type === "LINK_LOOM_EXTENSION_AUTH_ERROR") {
      void (async () => {
        const pendingNonce = await getPendingAuthNonce();

        if (!pendingNonce || authMessage.nonce !== pendingNonce) {
          sendResponse({ success: false, error: "invalid_auth_nonce" });
          return;
        }

        chrome.storage.local.set(
          { [AUTH_ERROR_STORAGE_KEY]: authMessage.message || "Google sign in failed." },
          () => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: "error_storage_failed" });
              return;
            }
            chrome.storage.local.remove([PENDING_AUTH_NONCE_STORAGE_KEY], () => {
              notifyExtensionPages({
                type: AUTH_ERROR_MESSAGE,
                error: authMessage.error,
                message: authMessage.message,
              });
              sendResponse({ success: true });
            });
          },
        );
      })();
      return true;
    }
  },
);

// Listen for bookmark changes
chrome.bookmarks.onCreated.addListener((_id, bookmark) => {
  console.log("Bookmark created:", {
    id: bookmark.id,
    parentId: bookmark.parentId,
    hasUrl: Boolean(bookmark.url),
  });
});
