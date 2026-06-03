import { createHash } from 'crypto';

export const MAX_QUEUE_ERROR_MESSAGE_LENGTH = 1000;

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g;
const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]+)\b/gi;
const LONG_HEX_PATTERN = /\b[0-9a-f]{32,}\b/gi;
const URL_WITH_CREDENTIALS_PATTERN = /\bhttps?:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi;

export const sanitizeQueueErrorMessage = (message: string): string => {
    const sanitized = message
        .replace(URL_WITH_CREDENTIALS_PATTERN, '[url-with-credentials]')
        .replace(BEARER_PATTERN, 'Bearer [redacted]')
        .replace(JWT_PATTERN, '[jwt]')
        .replace(API_KEY_PATTERN, '[api-key]')
        .replace(UUID_PATTERN, '[uuid]')
        .replace(EMAIL_PATTERN, '[email]')
        .replace(LONG_HEX_PATTERN, '[hex]');

    return sanitized.slice(0, MAX_QUEUE_ERROR_MESSAGE_LENGTH);
};

export const hashQueueErrorMessage = (message: string): string =>
    createHash('sha256').update(message).digest('hex');

export const prepareQueueJobFailureError = (error: unknown) => {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
        error_message_sanitized: sanitizeQueueErrorMessage(rawMessage),
        error_message_hash: hashQueueErrorMessage(rawMessage),
    };
};
