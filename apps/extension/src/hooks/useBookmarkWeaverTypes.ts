import { BookmarkRootTitle } from '../lib/bookmarkImport';

export const BACKEND_URL =
    (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(
        /\/$/,
        ''
    ) ?? '';

export const BACKEND_UNAVAILABLE_MESSAGE = BACKEND_URL
    ? `Cannot reach Link Loom backend at ${BACKEND_URL}. Please try again later.`
    : 'Link Loom backend is not configured. Please reinstall the extension.';

export const DEAD_LINK_SCAN_REQUEST_TIMEOUT_MS = 45000;
export const AUTO_RENAME_REQUEST_TIMEOUT_MS = 120000;
export const STRUCTURE_REQUEST_TIMEOUT_MS = 45000;
export const DEFAULT_FREE_TIER_LIMIT = 500;
export const DEFAULT_ROOT_TITLE: BookmarkRootTitle = 'Other Bookmarks';

export type AppStatus =
    | 'idle'
    | 'weaving'
    | 'ready'
    | 'done'
    | 'error'
    | 'limit_exceeded';

export type WeavingPhase = 'safety-backup' | 'ingest' | null;

export type LimitExceededInfo = {
    total: number;
    limit: number;
};

export type ProcessingIdentity = {
    userId: string;
    accessToken: string;
};

const NETWORK_ERROR_MESSAGE_PATTERNS = [
    'failed to fetch',
    'networkerror',
    'network error',
    'failed to connect',
] as const;

const messageLooksLikeNetworkError = (message: string) => {
    const normalized = message.toLowerCase();
    return NETWORK_ERROR_MESSAGE_PATTERNS.some((pattern) =>
        normalized.includes(pattern)
    );
};

export const isFailedFetchError = (error: unknown): boolean => {
    if (error instanceof Error) {
        if (error.name === 'NetworkError') {
            return true;
        }
        if (messageLooksLikeNetworkError(error.message)) {
            return true;
        }
        const cause = (error as Error & { cause?: unknown }).cause;
        if (cause !== undefined && isFailedFetchError(cause)) {
            return true;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return true;
        }
    }
    return false;
};

export const isAbortError = (error: unknown) =>
    error instanceof DOMException && error.name === 'AbortError';

export const getWeavingIngestErrorMessage = (error: unknown) =>
    isFailedFetchError(error)
        ? BACKEND_UNAVAILABLE_MESSAGE
        : error instanceof Error
          ? error.message
          : 'Something went wrong while organizing bookmarks.';
