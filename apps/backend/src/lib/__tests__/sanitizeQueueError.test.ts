import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
    hashQueueErrorMessage,
    MAX_QUEUE_ERROR_MESSAGE_LENGTH,
    prepareQueueJobFailureError,
    sanitizeQueueErrorMessage,
} from '../sanitizeQueueError';

describe('sanitizeQueueError', () => {
    it('redacts common secret and identifier patterns', () => {
        const message = [
            'user 00000000-0000-0000-0000-000000000001 failed',
            'email user@example.com',
            'Bearer secret-token',
            'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
            'key sk-abcdefghijklmnopqrstuvwxyz123456',
            'digest abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            'url https://user:pass@example.com/path',
        ].join(' ');

        expect(sanitizeQueueErrorMessage(message)).toBe([
            'user [uuid] failed',
            'email [email]',
            'Bearer [redacted]',
            'jwt [jwt]',
            'key [api-key]',
            'digest [hex]',
            'url [url-with-credentials]',
        ].join(' '));
    });

    it('truncates sanitized output to the database limit', () => {
        const message = 'x'.repeat(MAX_QUEUE_ERROR_MESSAGE_LENGTH + 50);
        expect(sanitizeQueueErrorMessage(message)).toHaveLength(MAX_QUEUE_ERROR_MESSAGE_LENGTH);
    });

    it('hashes the raw message and sanitizes Error instances', () => {
        const raw = 'boom for user@example.com';
        const prepared = prepareQueueJobFailureError(new Error(raw));

        expect(prepared.error_message_sanitized).toBe('boom for [email]');
        expect(prepared.error_message_hash).toBe(createHash('sha256').update(raw).digest('hex'));
        expect(prepared.error_message_hash).toBe(hashQueueErrorMessage(raw));
    });
});
