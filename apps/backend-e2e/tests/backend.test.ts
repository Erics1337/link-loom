import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  execSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type TestUser = {
  email: string;
  id: string;
  password: string;
  token: string;
};

type SupabaseEnv = {
  anonKey: string;
  serviceRoleKey: string;
  url: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const e2ePort = process.env.BACKEND_E2E_PORT ?? process.env.PORT ?? "3334";
const baseURL =
  process.env.BACKEND_E2E_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const e2eSecret = process.env.E2E_SECRET ?? `e2e-${randomUUID()}`;
const runId = randomUUID();
const testPassword = `LocalSupabase-${runId}!`;

let server: ChildProcessWithoutNullStreams | null = null;
let serverLogs = "";
let supabaseEnv: SupabaseEnv;
let adminClient: SupabaseClient;
let authClient: SupabaseClient;

const users = new Map<string, TestUser>();
const fixture = {
  statusBookmarks: {
    pending: randomUUID(),
    enriched: randomUUID(),
    embeddedOne: randomUUID(),
    embeddedTwo: randomUUID(),
    errored: randomUUID(),
  },
  statusCluster: randomUUID(),
};

const parseSupabaseStatusEnv = () => {
  const output = execSync("supabase status -o env", {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^export\s+/, ""))
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1
          ? [line, ""]
          : [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
      }),
  );
};

const resolveSupabaseEnv = (): SupabaseEnv => {
  const statusEnv =
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY
      ? {}
      : parseSupabaseStatusEnv();

  const url =
    process.env.SUPABASE_URL ??
    statusEnv.SUPABASE_URL ??
    statusEnv.API_URL ??
    "http://127.0.0.1:56421";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    statusEnv.SUPABASE_SERVICE_ROLE_KEY ??
    statusEnv.SERVICE_ROLE_KEY;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    statusEnv.SUPABASE_ANON_KEY ??
    statusEnv.ANON_KEY;

  if (!serviceRoleKey || !anonKey) {
    throw new Error(
      "Local Supabase keys were not found. Run `supabase start` and `supabase status -o env`.",
    );
  }

  return { anonKey, serviceRoleKey, url };
};

const request = async (pathname: string, init?: RequestInit) => {
  return fetch(`${baseURL}${pathname}`, init);
};

const readHealth = async () => {
  try {
    const response = await request("/health");
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
    if (health?.status === "ok") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Backend did not become healthy. Logs:\n${serverLogs}`);
};

const createTestUser = async (name: string, isPremium = false) => {
  const email = `${name}-${runId}@link-loom.local`;
  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password: testPassword,
      email_confirm: true,
    });

  if (createError || !created.user?.id) {
    throw new Error(
      `Failed to create ${name}: ${createError?.message ?? "missing user id"}`,
    );
  }

  const { data: session, error: signInError } =
    await authClient.auth.signInWithPassword({
      email,
      password: testPassword,
    });

  if (signInError || !session.session?.access_token) {
    throw new Error(
      `Failed to sign in ${name}: ${signInError?.message ?? "missing access token"}`,
    );
  }

  const { error: userError } = await adminClient
    .from("users")
    .upsert(
      { id: created.user.id, email, is_premium: isPremium },
      { onConflict: "id" },
    );

  if (userError) {
    throw new Error(`Failed to seed public user ${name}: ${userError.message}`);
  }

  const user = {
    email,
    id: created.user.id,
    password: testPassword,
    token: session.session.access_token,
  };
  users.set(name, user);
  return user;
};

const user = (name: string) => {
  const value = users.get(name);
  assert.ok(value, `Missing e2e user ${name}`);
  return value;
};

const authHeader = (name: string) => ({
  authorization: `Bearer ${user(name).token}`,
});

const e2eHeaders = () => ({ "x-e2e-secret": e2eSecret });

const seedStatusFixture = async () => {
  const statusUser = user("status");
  const { error: bookmarkError } = await adminClient.from("bookmarks").insert([
    {
      id: fixture.statusBookmarks.pending,
      user_id: statusUser.id,
      chrome_id: "pending-1",
      url: "https://example.com/pending",
      title: "Pending",
      status: "pending",
    },
    {
      id: fixture.statusBookmarks.enriched,
      user_id: statusUser.id,
      chrome_id: "enriched-1",
      url: "https://example.com/enriched",
      title: "Enriched",
      status: "enriched",
    },
    {
      id: fixture.statusBookmarks.embeddedOne,
      user_id: statusUser.id,
      chrome_id: "embedded-1",
      url: "https://example.com/embedded-1",
      title: "Embedded One",
      status: "embedded",
    },
    {
      id: fixture.statusBookmarks.embeddedTwo,
      user_id: statusUser.id,
      chrome_id: "embedded-2",
      url: "https://example.com/embedded-2",
      title: "Embedded Two",
      status: "embedded",
    },
    {
      id: fixture.statusBookmarks.errored,
      user_id: statusUser.id,
      chrome_id: "error-1",
      url: "https://example.com/error",
      title: "Errored",
      status: "error",
    },
  ]);

  if (bookmarkError)
    throw new Error(`Failed to seed bookmarks: ${bookmarkError.message}`);

  const { error: clusterError } = await adminClient.from("clusters").insert({
    id: fixture.statusCluster,
    user_id: statusUser.id,
    name: "Seeded Cluster",
  });

  if (clusterError)
    throw new Error(`Failed to seed cluster: ${clusterError.message}`);

  const { error: assignmentError } = await adminClient
    .from("cluster_assignments")
    .insert({
      cluster_id: fixture.statusCluster,
      bookmark_id: fixture.statusBookmarks.embeddedOne,
    });

  if (assignmentError)
    throw new Error(`Failed to seed assignment: ${assignmentError.message}`);
};

const seedDatabase = async () => {
  await Promise.all([
    createTestUser("status"),
    createTestUser("search"),
    createTestUser("ingest"),
    createTestUser("large-import"),
    createTestUser("bookmark"),
    createTestUser("duplicate"),
    createTestUser("ssrf-enrichment"),
    createTestUser("cancel-worker"),
    createTestUser("other"),
    createTestUser("premium", true),
  ]);

  await seedStatusFixture();
};

const cleanupDatabase = async () => {
  const ids = [...users.values()].map((item) => item.id);
  if (ids.length === 0) return;

  await adminClient.from("structure_snapshots").delete().in("user_id", ids);
  await adminClient.from("clusters").delete().in("user_id", ids);
  await adminClient.from("bookmarks").delete().in("user_id", ids);
  await adminClient.from("users").delete().in("id", ids);

  await Promise.all(
    [...users.values()].map(async (item) => {
      await adminClient.auth.admin.deleteUser(item.id);
    }),
  );
};

before(async () => {
  supabaseEnv = resolveSupabaseEnv();
  adminClient = createClient(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  authClient = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await seedDatabase();
  await readHealth();

  server = spawn("pnpm", ["--filter", "backend", "start"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SUPABASE_URL: supabaseEnv.url,
      SUPABASE_SERVICE_ROLE_KEY: supabaseEnv.serviceRoleKey,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test-openai-key",
      BACKEND_E2E_ENABLE_TEST_ENDPOINTS: "true",
      E2E_SECRET: e2eSecret,
      QUEUE_DRIVER: "test",
      NODE_ENV: "test",
      FREE_TIER_LIMIT: process.env.FREE_TIER_LIMIT ?? "500",
      HOST: process.env.HOST ?? "127.0.0.1",
      PORT: e2ePort,
    },
  });

  server.stdout.on("data", (chunk) => {
    serverLogs += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverLogs += chunk.toString();
  });

  await waitForHealth();
});

after(async () => {
  if (server) {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      server?.once("exit", () => resolve());
      setTimeout(resolve, 5000);
    });
  }

  await cleanupDatabase();
});

describe("backend HTTP contract", () => {
  const jsonRequest = async (
    pathname: string,
    userName: string,
    body: unknown,
  ) => {
    return request(pathname, {
      method: "POST",
      headers: {
        ...authHeader(userName),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };

  const readQueuedJobs = async () => {
    const response = await request("/__e2e/queues", { headers: e2eHeaders() });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ jobs: Array<any> }>;
  };

  const clearQueuedJobs = async () => {
    const response = await request("/__e2e/queues", {
      method: "DELETE",
      headers: e2eHeaders(),
    });
    assert.equal(response.status, 200);
  };

  const drainQueuedJobs = async (maxJobs: number) => {
    const response = await request("/__e2e/queues/drain", {
      method: "POST",
      headers: { ...e2eHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ maxJobs }),
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<{
      processed: Array<{ queue: string; jobName: string; jobId?: string }>;
      remaining: number;
    }>;
  };

  const readBookmarks = async (userName: string) => {
    const response = await request(`/__e2e/bookmarks/${user(userName).id}`, {
      headers: e2eHeaders(),
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ bookmarks: Array<any> }>;
  };

  it("reports health", async () => {
    const response = await request("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("requires authentication on user-scoped routes", async () => {
    const response = await request(`/status/${user("status").id}`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "Authentication required.");
  });

  it("requires authentication on body-scoped backend tools", async () => {
    const cases = [
      request("/register-device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "device-1" }),
      }),
      request("/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "bookmarks" }),
      }),
      request("/dead-links/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookmarks: [] }),
      }),
    ];

    for (const responsePromise of cases) {
      const response = await responsePromise;
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(body.error, "Authentication required.");
    }
  });

  it("rejects empty search queries before requesting embeddings", async () => {
    const response = await jsonRequest("/search", "search", {
      query: "   ",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "Query is required");
  });

  it("reports detailed pipeline status for an authenticated user", async () => {
    const response = await request(`/status/${user("status").id}`, {
      headers: authHeader("status"),
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

  it("queues a full bookmark ingest request", async () => {
    const response = await jsonRequest("/ingest", "ingest", {
      bookmarks: [
        { id: "chrome-1", title: "Example", url: "https://example.com" },
        { id: "chrome-2", title: "Docs", url: "https://example.com/docs" },
      ],
      clusteringSettings: {
        folderDensity: "more",
        namingTone: "playful",
        organizationMode: "topic",
        useEmojiNames: true,
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "queued" });
  });

  it("queues manual clustering for the authenticated user", async () => {
    const response = await jsonRequest(
      `/trigger-clustering/${user("status").id}`,
      "status",
      {
        clusteringSettings: { folderDensity: "fewer" },
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "clustering_queued" });
  });

  it("prevents trigger-clustering for a different user id", async () => {
    const response = await jsonRequest(
      `/trigger-clustering/${user("status").id}`,
      "other",
      {},
    );
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "User id does not match authenticated session.");
  });

  it("rejects ingests that exceed the free tier limit", async () => {
    const bookmarks = Array.from({ length: 501 }, (_, index) => ({
      id: `chrome-${index}`,
      title: `Bookmark ${index}`,
      url: `https://example.com/${index}`,
    }));
    const response = await jsonRequest("/ingest", "large-import", {
      bookmarks,
    });
    const body = await response.json();

    assert.equal(response.status, 402);
    assert.equal(body.error, "Bookmark limit exceeded");
    assert.equal(body.limit, 500);
    assert.equal(body.attempted, 501);
  });

  it("rejects unauthenticated manual bookmark ingestion before touching queues", async () => {
    const response = await request("/bookmarks/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "Authentication required.");
  });

  it("queues a manual bookmark through the ingest pipeline", async () => {
    await clearQueuedJobs();

    const response = await jsonRequest("/bookmarks/add", "bookmark", {
      url: "https://example.com/saved",
      title: "Saved Example",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "queued");
    assert.match(body.chromeId, /^manual-/);

    const { jobs } = await readQueuedJobs();
    const ingestJob = jobs.find(
      (job) =>
        job.queue === "ingest" && job.data.userId === user("bookmark").id,
    );
    assert.ok(ingestJob);
    assert.equal(ingestJob.jobName, "ingest");
    assert.equal(ingestJob.attempts, 5);
    assert.equal(ingestJob.data.bookmarks[0].chromeId, undefined);
    assert.equal(ingestJob.data.bookmarks[0].id, body.chromeId);
    assert.equal(ingestJob.data.bookmarks[0].title, "Saved Example");
    assert.equal(ingestJob.data.bookmarks[0].url, "https://example.com/saved");
    assert.match(
      ingestJob.jobId,
      new RegExp(`^ingest-${user("bookmark").id}-manual-generation-`),
    );
  });

  it("queues duplicate manual URLs as distinct Chrome bookmark entries", async () => {
    await clearQueuedJobs();

    const firstResponse = await jsonRequest("/bookmarks/add", "duplicate", {
      url: "https://example.com/duplicate",
      title: "First Duplicate",
    });
    const secondResponse = await jsonRequest("/bookmarks/add", "duplicate", {
      url: "https://example.com/duplicate",
      title: "Second Duplicate",
    });
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.notEqual(firstBody.chromeId, secondBody.chromeId);

    const { jobs } = await readQueuedJobs();
    const duplicateJobs = jobs.filter(
      (job) =>
        job.queue === "ingest" && job.data.userId === user("duplicate").id,
    );

    assert.equal(duplicateJobs.length, 2);
    assert.deepEqual(
      duplicateJobs.map((job) => job.data.bookmarks[0].url),
      ["https://example.com/duplicate", "https://example.com/duplicate"],
    );
    assert.notEqual(
      duplicateJobs[0].data.bookmarks[0].id,
      duplicateJobs[1].data.bookmarks[0].id,
    );
  });

  it("rejects invalid manual bookmark URLs", async () => {
    const response = await jsonRequest("/bookmarks/add", "bookmark", {
      url: "not a url",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "A valid URL is required.");
  });

  it("blocks localhost SSRF targets through the real manual ingest and enrichment path", async () => {
    await clearQueuedJobs();

    let privateHitCount = 0;
    const privateServer = http.createServer((_req, res) => {
      privateHitCount++;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>Private Metadata</title>");
    });
    await new Promise<void>((resolve) =>
      privateServer.listen(0, "127.0.0.1", resolve),
    );

    try {
      const address = privateServer.address();
      assert.ok(address && typeof address === "object");
      const privateUrl = `http://127.0.0.1:${address.port}/latest/meta-data`;

      const response = await jsonRequest("/bookmarks/add", "ssrf-enrichment", {
        url: privateUrl,
        title: "Metadata Trap",
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, "queued");

      const drained = await drainQueuedJobs(2);
      assert.deepEqual(
        drained.processed.map((job) => job.queue),
        ["ingest", "enrichment"],
      );

      const { bookmarks } = await readBookmarks("ssrf-enrichment");
      const bookmark = bookmarks.find(
        (item) => item.chrome_id === body.chromeId,
      );

      assert.ok(bookmark);
      assert.equal(bookmark.status, "enriched");
      assert.equal(bookmark.description, "");
      assert.equal(privateHitCount, 0);

      const { jobs } = await readQueuedJobs();
      const embeddingJob = jobs.find(
        (job) =>
          job.queue === "embedding" &&
          job.data.userId === user("ssrf-enrichment").id &&
          job.data.bookmarkId === bookmark.id,
      );
      assert.ok(embeddingJob);
      assert.equal(embeddingJob.jobName, "embed");
      assert.match(
        embeddingJob.jobId,
        new RegExp(`^embed-${user("ssrf-enrichment").id}-generation-`),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        privateServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns structure clusters and assignments for the authenticated user", async () => {
    const response = await request(`/structure/${user("status").id}`, {
      headers: authHeader("status"),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.clusters.length, 1);
    assert.equal(body.clusters[0].id, fixture.statusCluster);
    assert.equal(body.assignments.length, 1);
    assert.equal(
      body.assignments[0].bookmark_id,
      fixture.statusBookmarks.embeddedOne,
    );
  });

  it("prevents structure reads for a different user id", async () => {
    const response = await request(`/structure/${user("status").id}`, {
      headers: authHeader("other"),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "User id does not match authenticated session.");
  });

  it("creates, lists, restores, and deletes backup snapshots", async () => {
    const createResponse = await jsonRequest(
      `/backups/${user("status").id}`,
      "status",
      {
        name: "E2E Snapshot",
      },
    );
    const createBody = await createResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(createBody.status, "created");
    assert.match(createBody.snapshotId, /^[0-9a-f-]{36}$/i);

    const listResponse = await request(`/backups/${user("status").id}`, {
      headers: authHeader("status"),
    });
    const listBody = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.ok(
      listBody.backups.some(
        (backup: any) => backup.id === createBody.snapshotId,
      ),
    );

    const restoreResponse = await request(
      `/backups/${user("status").id}/${createBody.snapshotId}/restore`,
      {
        method: "POST",
        headers: authHeader("status"),
      },
    );
    assert.equal(restoreResponse.status, 200);
    assert.deepEqual(await restoreResponse.json(), { status: "restored" });

    const deleteResponse = await request(
      `/backups/${user("status").id}/${createBody.snapshotId}`,
      {
        method: "DELETE",
        headers: authHeader("status"),
      },
    );
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { status: "deleted" });
  });

  it("prevents backup access for a different user id", async () => {
    const response = await request(`/backups/${user("status").id}`, {
      headers: authHeader("other"),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "User id does not match authenticated session.");
  });

  it("prevents auto-rename for a different user id before premium work", async () => {
    const response = await jsonRequest(
      `/auto-rename/${user("status").id}`,
      "other",
      {},
    );
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "User id does not match authenticated session.");
  });

  it("runs premium dead-link checks without allowing localhost SSRF targets through", async () => {
    const response = await jsonRequest("/dead-links/check", "premium", {
      bookmarks: [
        {
          chromeId: "chrome-localhost",
          url: "http://127.0.0.1/latest/meta-data",
        },
      ],
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.scanned, 1);
    assert.equal(body.dead, 0);
    assert.deepEqual(body.deadChromeIds, []);
  });

  it("cancels an authenticated user pipeline and clears inflight statuses", async () => {
    const cancelResponse = await request(`/cancel/${user("status").id}`, {
      method: "POST",
      headers: authHeader("status"),
    });
    const cancelBody = await cancelResponse.json();

    assert.equal(cancelResponse.status, 200);
    assert.deepEqual(cancelBody, { status: "cancelled" });

    const statusResponse = await request(`/status/${user("status").id}`, {
      headers: authHeader("status"),
    });
    const statusBody = await statusResponse.json();

    assert.equal(statusResponse.status, 200);
    assert.equal(statusBody.pendingRaw, 0);
    assert.equal(statusBody.enriched, 0);
    assert.equal(statusBody.pending, 0);
    assert.equal(statusBody.isIngesting, false);
  });

  it("prevents stale queued workers from writing after cancellation", async () => {
    await clearQueuedJobs();

    const ingestResponse = await jsonRequest("/ingest", "cancel-worker", {
      bookmarks: [
        {
          id: "cancel-chrome-1",
          title: "Should Not Write",
          url: "https://example.com/cancelled",
        },
      ],
    });
    assert.equal(ingestResponse.status, 200);
    assert.deepEqual(await ingestResponse.json(), { status: "queued" });

    const queuedBeforeCancel = await readQueuedJobs();
    const queuedIngest = queuedBeforeCancel.jobs.find(
      (job) =>
        job.queue === "ingest" && job.data.userId === user("cancel-worker").id,
    );
    assert.ok(queuedIngest);
    assert.equal(queuedIngest.data.jobGeneration, 1);

    const cancelResponse = await request(
      `/cancel/${user("cancel-worker").id}`,
      {
        method: "POST",
        headers: authHeader("cancel-worker"),
      },
    );
    assert.equal(cancelResponse.status, 200);
    assert.deepEqual(await cancelResponse.json(), { status: "cancelled" });

    const drained = await drainQueuedJobs(5);
    assert.deepEqual(
      drained.processed.map((job) => job.queue),
      ["ingest"],
    );
    assert.equal(drained.remaining, 0);

    const { bookmarks } = await readBookmarks("cancel-worker");
    assert.equal(bookmarks.length, 0);

    const queuedAfterDrain = await readQueuedJobs();
    assert.equal(
      queuedAfterDrain.jobs.some(
        (job) => job.data?.userId === user("cancel-worker").id,
      ),
      false,
    );
  });

  it("prevents authenticated users from operating on another user id", async () => {
    const response = await request(`/cancel/${user("status").id}`, {
      method: "POST",
      headers: authHeader("other"),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "User id does not match authenticated session.");
  });
});
