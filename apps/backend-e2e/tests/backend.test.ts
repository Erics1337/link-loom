import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
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

  const readQueuedJobs = async () => {
    const response = await request('/__e2e/queues');
    assert.equal(response.status, 200);
    return response.json() as Promise<{ jobs: Array<any> }>;
  };

  const clearQueuedJobs = async () => {
    const response = await request('/__e2e/queues', { method: 'DELETE' });
    assert.equal(response.status, 200);
  };

  const drainQueuedJobs = async (maxJobs: number) => {
    const response = await request('/__e2e/queues/drain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxJobs }),
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      processed: Array<{ queue: string; jobName: string; jobId?: string }>;
      remaining: number;
    }>;
  };

  const readBookmarks = async (userId: string) => {
    const response = await request(`/__e2e/bookmarks/${userId}`);
    assert.equal(response.status, 200);
    return response.json() as Promise<{ bookmarks: Array<any> }>;
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

  it('queues manual clustering for the authenticated user', async () => {
    const response = await jsonRequest('/trigger-clustering/status-user', 'status-user', {
      clusteringSettings: { folderDensity: 'fewer' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: 'clustering_queued' });
  });

  it('prevents trigger-clustering for a different user id', async () => {
    const response = await jsonRequest('/trigger-clustering/status-user', 'other-user', {});
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, 'User id does not match authenticated session.');
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
    await clearQueuedJobs();

    const response = await jsonRequest('/bookmarks/add', 'bookmark-user', {
      url: 'https://example.com/saved',
      title: 'Saved Example',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'queued');
    assert.match(body.chromeId, /^manual-/);

    const { jobs } = await readQueuedJobs();
    const ingestJob = jobs.find((job) => job.queue === 'ingest' && job.data.userId === 'bookmark-user');
    assert.ok(ingestJob);
    assert.equal(ingestJob.jobName, 'ingest');
    assert.equal(ingestJob.attempts, 5);
    assert.equal(ingestJob.data.bookmarks[0].chromeId, undefined);
    assert.equal(ingestJob.data.bookmarks[0].id, body.chromeId);
    assert.equal(ingestJob.data.bookmarks[0].title, 'Saved Example');
    assert.equal(ingestJob.data.bookmarks[0].url, 'https://example.com/saved');
    assert.match(ingestJob.jobId, /^ingest-bookmark-user-manual-generation-/);
  });

  it('queues duplicate manual URLs as distinct Chrome bookmark entries', async () => {
    await clearQueuedJobs();

    const firstResponse = await jsonRequest('/bookmarks/add', 'duplicate-user', {
      url: 'https://example.com/duplicate',
      title: 'First Duplicate',
    });
    const secondResponse = await jsonRequest('/bookmarks/add', 'duplicate-user', {
      url: 'https://example.com/duplicate',
      title: 'Second Duplicate',
    });
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.notEqual(firstBody.chromeId, secondBody.chromeId);

    const { jobs } = await readQueuedJobs();
    const duplicateJobs = jobs.filter((job) => job.queue === 'ingest' && job.data.userId === 'duplicate-user');

    assert.equal(duplicateJobs.length, 2);
    assert.deepEqual(
      duplicateJobs.map((job) => job.data.bookmarks[0].url),
      ['https://example.com/duplicate', 'https://example.com/duplicate']
    );
    assert.notEqual(
      duplicateJobs[0].data.bookmarks[0].id,
      duplicateJobs[1].data.bookmarks[0].id
    );
  });

  it('rejects invalid manual bookmark URLs', async () => {
    const response = await jsonRequest('/bookmarks/add', 'bookmark-user', {
      url: 'not a url',
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'A valid URL is required.');
  });

  it('blocks localhost SSRF targets through the real manual ingest and enrichment path', async () => {
    await clearQueuedJobs();

    let privateHitCount = 0;
    const privateServer = http.createServer((_req, res) => {
      privateHitCount++;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Private Metadata</title>');
    });
    await new Promise<void>((resolve) => privateServer.listen(0, '127.0.0.1', resolve));

    try {
      const address = privateServer.address();
      assert.ok(address && typeof address === 'object');
      const privateUrl = `http://127.0.0.1:${address.port}/latest/meta-data`;

      const response = await jsonRequest('/bookmarks/add', 'ssrf-enrichment-user', {
        url: privateUrl,
        title: 'Metadata Trap',
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, 'queued');

      const drained = await drainQueuedJobs(2);
      assert.deepEqual(
        drained.processed.map((job) => job.queue),
        ['ingest', 'enrichment']
      );

      const { bookmarks } = await readBookmarks('ssrf-enrichment-user');
      const bookmark = bookmarks.find((item) => item.chrome_id === body.chromeId);

      assert.ok(bookmark);
      assert.equal(bookmark.status, 'enriched');
      assert.equal(bookmark.description, '');
      assert.equal(privateHitCount, 0);

      const { jobs } = await readQueuedJobs();
      const embeddingJob = jobs.find((job) =>
        job.queue === 'embedding' &&
        job.data.userId === 'ssrf-enrichment-user' &&
        job.data.bookmarkId === bookmark.id
      );
      assert.ok(embeddingJob);
      assert.equal(embeddingJob.jobName, 'embed');
      assert.match(embeddingJob.jobId, /^embed-ssrf-enrichment-user-generation-/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        privateServer.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('returns structure clusters and assignments for the authenticated user', async () => {
    const response = await request('/structure/status-user', {
      headers: { authorization: 'Bearer status-user' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.clusters.length, 1);
    assert.equal(body.clusters[0].id, 'cluster-1');
    assert.equal(body.assignments.length, 1);
    assert.equal(body.assignments[0].bookmark_id, 'embedded-1');
  });

  it('prevents structure reads for a different user id', async () => {
    const response = await request('/structure/status-user', {
      headers: { authorization: 'Bearer other-user' },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, 'User id does not match authenticated session.');
  });

  it('creates, lists, restores, and deletes backup snapshots', async () => {
    const createResponse = await jsonRequest('/backups/status-user', 'status-user', {
      name: 'E2E Snapshot',
    });
    const createBody = await createResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(createBody.status, 'created');
    assert.match(createBody.snapshotId, /^snapshot-/);

    const listResponse = await request('/backups/status-user', {
      headers: { authorization: 'Bearer status-user' },
    });
    const listBody = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.ok(listBody.backups.some((backup: any) => backup.id === createBody.snapshotId));

    const restoreResponse = await request(`/backups/status-user/${createBody.snapshotId}/restore`, {
      method: 'POST',
      headers: { authorization: 'Bearer status-user' },
    });
    assert.equal(restoreResponse.status, 200);
    assert.deepEqual(await restoreResponse.json(), { status: 'restored' });

    const deleteResponse = await request(`/backups/status-user/${createBody.snapshotId}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer status-user' },
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { status: 'deleted' });
  });

  it('prevents backup access for a different user id', async () => {
    const response = await request('/backups/status-user', {
      headers: { authorization: 'Bearer other-user' },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, 'User id does not match authenticated session.');
  });

  it('runs premium dead-link checks without allowing localhost SSRF targets through', async () => {
    const response = await jsonRequest('/dead-links/check', 'premium-user', {
      bookmarks: [
        { chromeId: 'chrome-localhost', url: 'http://127.0.0.1/latest/meta-data' },
      ],
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.scanned, 1);
    assert.equal(body.dead, 0);
    assert.deepEqual(body.deadChromeIds, []);
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
