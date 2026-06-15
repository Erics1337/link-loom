import {
    AUTH_COMPLETE_MESSAGE,
    AUTH_ERROR_MESSAGE,
    buildStoredSessionFromAuthMessage,
    ExtensionAuthMessage,
    SESSION_STORAGE_KEY
} from './lib/extensionAuthSession';

console.log('Link Loom background script loaded');

const ALLOWED_EXTERNAL_ORIGINS = new Set([
    'https://linkloom.org',
    'http://localhost:3000'
]);

const isAllowedExternalOrigin = (senderUrl?: string) => {
    if (!senderUrl) return false;

    try {
        const { origin, hostname } = new URL(senderUrl);
        return (
            ALLOWED_EXTERNAL_ORIGINS.has(origin) ||
            (origin.startsWith('https://') && hostname.endsWith('.linkloom.org'))
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

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const authMessage = message as ExtensionAuthMessage | undefined;
    if (!authMessage?.type) {
        return;
    }

    if (!isAllowedExternalOrigin(sender.url)) {
        sendResponse({ success: false, error: 'unauthorized_origin' });
        return;
    }

    if (authMessage.type === 'LINK_LOOM_EXTENSION_AUTH') {
        const session = buildStoredSessionFromAuthMessage(authMessage);

        chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session }, () => {
            notifyExtensionPages({
                type: AUTH_COMPLETE_MESSAGE,
                session
            });

            if (sender.tab?.id !== undefined) {
                chrome.tabs.remove(sender.tab.id).catch(() => {});
            }

            sendResponse({ success: true });
        });

        return true;
    }

    if (authMessage.type === 'LINK_LOOM_EXTENSION_AUTH_ERROR') {
        notifyExtensionPages({
            type: AUTH_ERROR_MESSAGE,
            error: authMessage.error,
            message: authMessage.message
        });

        if (sender.tab?.id !== undefined) {
            chrome.tabs.remove(sender.tab.id).catch(() => {});
        }

        sendResponse({ success: true });
        return true;
    }
});

// Listen for bookmark changes
chrome.bookmarks.onCreated.addListener((_id, bookmark) => {
    console.log('Bookmark created:', {
        id: bookmark.id,
        parentId: bookmark.parentId,
        hasUrl: Boolean(bookmark.url)
    });
});
