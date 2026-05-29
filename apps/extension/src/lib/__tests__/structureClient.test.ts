import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StructureClient } from '../structureClient';

const createClient = () => new StructureClient({
    backendUrl: 'https://backend.example',
    buildAuthHeaders: () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer token' }),
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
});

describe('StructureClient', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('throws detailed errors when status requests fail', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            text: async () => '{"error":"nope"}',
        })));

        await expect(createClient().getStatus('user-1')).rejects.toThrow(
            'Status request failed (403 Forbidden): {"error":"nope"}'
        );
    });

    it('cancels without sending obsolete queue-clearing request bodies', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({ status: 'cancelled' }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        await createClient().cancel('user-1');

        expect(fetchMock).toHaveBeenCalledWith('https://backend.example/cancel/user-1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        });
    });
});
