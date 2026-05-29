import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'dns/promises';
import { safeFetch } from '../safeFetch';

vi.mock('dns/promises', () => ({
    lookup: vi.fn(),
}));

describe('safeFetch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
    });

    it('rejects localhost without fetching', async () => {
        await expect(safeFetch('http://localhost/private')).rejects.toThrow('Localhost URLs are not allowed.');

        expect(lookup).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects hostnames that resolve to private addresses', async () => {
        (lookup as any).mockResolvedValue([{ address: '10.0.0.12', family: 4 }]);

        await expect(safeFetch('https://example.com/private')).rejects.toThrow('Private network URLs are not allowed.');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('validates redirect targets before following them', async () => {
        (lookup as any)
            .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
            .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
        (global.fetch as any).mockResolvedValueOnce(new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1/admin' },
        }));

        await expect(safeFetch('https://example.com/redirect')).rejects.toThrow('Private network URLs are not allowed.');

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
