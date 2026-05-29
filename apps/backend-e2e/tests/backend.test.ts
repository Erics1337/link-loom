import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const baseURL = process.env.BACKEND_E2E_BASE_URL ?? 'http://127.0.0.1:3333';

let server: ChildProcessWithoutNullStreams | null = null;
let serverLogs = '';

const request = async (pathname: string, init?: RequestInit) => {
  return fetch(`${baseURL}${pathname}`, init);
};

const readHealth = async () => {
  try {
    const response = await request('/health');
    if (!response.ok) return null;
    return response.json() as Promise<{ status?: string }>;
  } catch {
    return null;
  }
};

const waitForHealth = async () => {
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    const health = await readHealth();
    if (health?.status === 'ok') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Backend did not become healthy. Logs:\n${serverLogs}`);
};

before(async () => {
  const existingHealth = await readHealth();
  if (existingHealth?.status === 'ok') return;

  server = spawn('pnpm', ['--filter', 'backend', 'start'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'test-openai-key',
      BACKEND_E2E_FAKE_SUPABASE: process.env.BACKEND_E2E_FAKE_SUPABASE ?? 'true',
      QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'test',
      FREE_TIER_LIMIT: process.env.FREE_TIER_LIMIT ?? '500',
      HOST: process.env.HOST ?? '127.0.0.1',
      PORT: process.env.PORT ?? '3333',
    },
  });

  server.stdout.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });

  await waitForHealth();
});

after(async () => {
  if (!server) return;

  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    server?.once('exit', () => resolve());
    setTimeout(resolve, 5000);
  });
});

describe('backend HTTP contract', () => {
  const jsonRequest = async (pathname: string, userId: string, body: unknown) => {
    return request(pathname, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userId}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  };

  it('reports health', async () => {
    const response = await request('/health');

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('requires authentication on user-scoped routes', async () => {
    const response = await request('/status/e2e-user');
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'Authentication required.');
  });

  it('reports detailed pipeline status for an authenticated user', async () => {
    const response = await request('/status/status-user', {
      headers: { authorization: 'Bearer status-user' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.total, 5);
    assert.equal(body.pendingRaw, 1);
    assert.equal(body.enriched, 1);
    assert.equal(body.embedded, 2);
    assert.equal(body.errored, 1);
    assert.equal(body.pending, 2);
    assert.equal(body.processing, 2);
    assert.equal(body.clusters, 1);
    assert.equal(body.assigned, 1);
    assert.equal(body.remainingToAssign, 1);
    assert.equal(body.isIngesting, true);
    assert.equal(body.isDone, false);
  });

  it('queues a full bookmark ingest request', async () => {
    const response = await jsonRequest('/ingest', 'ingest-user', {
      bookmarks: [
        { id: 'chrome-1', title: 'Example', url: 'https://example.com' },
        { id: 'chrome-2', title: 'Docs', url: 'https://example.com/docs' },
      ],
      clusteringSettings: {
        folderDensity: 'more',
        namingTone: 'playful',
        organizationMode: 'topic',
        useEmojiNames: true,
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: 'queued' });
  });

  it('rejects ingests that exceed the free tier limit', async () => {
    const bookmarks = Array.from({ length: 501 }, (_, index) => ({
      id: `chrome-${index}`,
      title: `Bookmark ${index}`,
      url: `https://example.com/${index}`,
    }));
    const response = await jsonRequest('/ingest', 'large-import-user', { bookmarks });
    const body = await response.json();

    assert.equal(response.status, 402);
    assert.equal(body.error, 'Bookmark limit exceeded');
    assert.equal(body.limit, 500);
    assert.equal(body.attempted, 501);
  });

  it('rejects unauthenticated manual bookmark ingestion before touching queues', async () => {
    const response = await request('/bookmarks/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, 'Authentication required.');
  });

  it('queues a manual bookmark through the ingest pipeline', async () => {
    const response = await jsonRequest('/bookmarks/add', 'bookmark-user', {
      url: 'https://example.com/saved',
      title: 'Saved Example',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'queued');
    assert.match(body.chromeId, /^manual-/);
  });

  it('rejects invalid manual bookmark URLs', async () => {
    const response = await jsonRequest('/bookmarks/add', 'bookmark-user', {
      url: 'not a url',
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'A valid URL is required.');
  });

  it('cancels an authenticated user pipeline and clears inflight statuses', async () => {
    const cancelResponse = await request('/cancel/status-user', {
      method: 'POST',
      headers: { authorization: 'Bearer status-user' },
    });
    const cancelBody = await cancelResponse.json();

    assert.equal(cancelResponse.status, 200);
    assert.deepEqual(cancelBody, { status: 'cancelled' });

    const statusResponse = await request('/status/status-user', {
      headers: { authorization: 'Bearer status-user' },
    });
    const statusBody = await statusResponse.json();

    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.pendingRaw, 0);
    assert.equal(statusBody.enriched, 0);
    assert.equal(statusBody.pending, 0);
    assert.equal(statusBody.isIngesting, false);
  });

  it('prevents authenticated users from operating on another user id', async () => {
    const response = await request('/cancel/status-user', {
      method: 'POST',
      headers: { authorization: 'Bearer other-user' },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, 'User id does not match authenticated session.');
  });
});
