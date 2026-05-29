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
      QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'inline',
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
});
