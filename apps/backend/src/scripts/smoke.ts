type SmokeResult = {
    name: string;
    ok: boolean;
    detail: string;
};

const backendUrl = (process.env.BACKEND_SMOKE_URL || process.env.BACKEND_URL || 'http://127.0.0.1:3333').replace(/\/$/, '');
const userId = process.env.BACKEND_SMOKE_USER_ID || '';
const accessToken = process.env.BACKEND_SMOKE_ACCESS_TOKEN || process.env.BACKEND_SMOKE_TOKEN || '';
const runEmptyIngest = process.env.BACKEND_SMOKE_RUN_EMPTY_INGEST === 'true';

const requestJson = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${backendUrl}${path}`, {
        ...init,
        headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...init.headers,
        },
    });
    const text = await response.text();
    let body: unknown = text;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        // Keep raw text for diagnostics.
    }

    return { response, body };
};

const result = (name: string, ok: boolean, detail: string): SmokeResult => ({ name, ok, detail });

const smokeHealth = async () => {
    const { response, body } = await requestJson('/health');
    return result('health', response.ok && (body as any)?.status === 'ok', `${response.status} ${JSON.stringify(body)}`);
};

const smokeStatus = async () => {
    if (!userId || !accessToken) {
        return result('status', false, 'BACKEND_SMOKE_USER_ID and BACKEND_SMOKE_ACCESS_TOKEN are required');
    }

    const { response, body } = await requestJson(`/status/${encodeURIComponent(userId)}`);
    return result('status', response.ok && typeof (body as any)?.total === 'number', `${response.status} ${JSON.stringify(body)}`);
};

const smokeEmptyIngest = async () => {
    if (!runEmptyIngest) {
        return result(
            'ingest-empty',
            true,
            'skipped; set BACKEND_SMOKE_RUN_EMPTY_INGEST=true for a dedicated smoke account'
        );
    }

    if (!userId || !accessToken) {
        return result('ingest-empty', false, 'BACKEND_SMOKE_USER_ID and BACKEND_SMOKE_ACCESS_TOKEN are required');
    }

    const { response, body } = await requestJson('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarks: [], clusteringSettings: {} }),
    });
    return result('ingest-empty', response.ok && (body as any)?.status === 'queued', `${response.status} ${JSON.stringify(body)}`);
};

const main = async () => {
    console.log(`[SMOKE] Backend: ${backendUrl}`);
    const results = [
        await smokeHealth(),
        await smokeStatus(),
        await smokeEmptyIngest(),
    ];

    for (const item of results) {
        console.log(`[SMOKE] ${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
    }

    const failures = results.filter((item) => !item.ok);
    if (failures.length > 0) {
        process.exitCode = 1;
    }
};

main().catch((error) => {
    console.error('[SMOKE] Failed to run backend smoke checks', error);
    process.exitCode = 1;
});
