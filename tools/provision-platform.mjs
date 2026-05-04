import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const platformDir = resolve(root, "apps/platform");
const wranglerPath = resolve(platformDir, "wrangler.jsonc");
const generatedPath = resolve(platformDir, "wrangler.generated.jsonc");
const envLocalPath = resolve(platformDir, ".env.local");
const migrationPath = resolve(platformDir, "migrations/0001_platform.sql");

const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requiredEnv("CLOUDFLARE_API_TOKEN");
const apiBase = "https://api.cloudflare.com/client/v4";

const resourceNames = {
  d1: process.env.OPEN_THINK_D1_DATABASE_NAME ?? "open-think-platform",
  r2: process.env.OPEN_THINK_R2_BUCKET_NAME ?? "open-think-agents",
  queue: process.env.OPEN_THINK_QUEUE_NAME ?? "open-think-deployments",
  vectorize: process.env.OPEN_THINK_VECTORIZE_INDEX_NAME ?? "open-think-memory"
};

const [d1, r2, queue, vectorize] = await Promise.all([
  ensureD1(resourceNames.d1),
  ensureR2(resourceNames.r2),
  ensureQueue(resourceNames.queue),
  ensureVectorize(resourceNames.vectorize)
]);
const d1Id = d1.uuid ?? d1.id;
if (!d1Id) {
  throw new Error(`D1 database ${d1.name} did not include an id.`);
}
await applyD1Migration(d1Id);

const config = JSON.parse(await readFile(wranglerPath, "utf8"));
config.d1_databases = [
  {
    binding: "DB",
    database_name: d1.name,
    database_id: d1Id
  }
];
config.r2_buckets = [
  {
    binding: "AGENT_STORAGE",
    bucket_name: r2.name
  }
];
config.vectorize = [
  {
    binding: "VECTORIZE",
    index_name: vectorize.name
  }
];
config.queues = {
  producers: [
    {
      binding: "DEPLOYMENT_QUEUE",
      queue: queue.queue_name ?? queue.name ?? resourceNames.queue
    }
  ]
};

await writeFile(generatedPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
await upsertEnvLocal({
  CLOUDFLARE_ACCOUNT_ID: accountId,
  OPEN_THINK_PLATFORM_D1_DATABASE_ID: d1Id
});

console.log(`Prepared ${generatedPath}`);
console.log(`Prepared ${envLocalPath}`);
console.log(`D1: ${d1.name} (${d1Id})`);
console.log(`R2: ${r2.name}`);
console.log(`Queue: ${queue.queue_name ?? queue.name ?? resourceNames.queue}`);
console.log(`Vectorize: ${vectorize.name}`);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function ensureD1(name) {
  const databases = await request(`/accounts/${accountId}/d1/database`);
  const existing = databases.find((database) => database.name === name);
  if (existing) return existing;
  return request(`/accounts/${accountId}/d1/database`, {
    method: "POST",
    body: { name }
  });
}

async function ensureR2(name) {
  const existing = await tryRequest(`/accounts/${accountId}/r2/buckets/${name}`);
  if (existing) return existing;
  return request(`/accounts/${accountId}/r2/buckets`, {
    method: "POST",
    body: { name }
  });
}

async function ensureQueue(name) {
  const queues = await request(`/accounts/${accountId}/queues`);
  const existing = queues.find((queue) => queue.queue_name === name || queue.name === name);
  if (existing) return existing;
  return request(`/accounts/${accountId}/queues`, {
    method: "POST",
    body: { queue_name: name }
  });
}

async function ensureVectorize(name) {
  const existing = await tryRequest(`/accounts/${accountId}/vectorize/v2/indexes/${name}`);
  if (existing) return existing;
  return request(`/accounts/${accountId}/vectorize/v2/indexes`, {
    method: "POST",
    body: {
      name,
      description: "open-think platform semantic memory",
      config: {
        dimensions: 1536,
        metric: "cosine"
      }
    }
  });
}

async function applyD1Migration(databaseId) {
  const sql = await readFile(migrationPath, "utf8");
  const batch = splitSqlStatements(sql).map((statement) => ({ sql: statement }));
  await request(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    body: { batch }
  });
}

async function upsertEnvLocal(values) {
  const existing = await readFile(envLocalPath, "utf8").catch(() => "");
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => line.trim() && !Object.hasOwn(values, line.split("=")[0]));

  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`);
  }

  await writeFile(envLocalPath, `${lines.join("\n")}\n`, "utf8");
}

function splitSqlStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function tryRequest(path, init) {
  try {
    return await request(path, init);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function request(path, init = {}) {
  const requestInit = {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    }
  };

  if (init.body !== undefined) {
    requestInit.body = JSON.stringify(init.body);
  }

  const response = await fetch(`${apiBase}${path}`, requestInit);
  const body = await response.json().catch(() => null);

  if (!response.ok || body?.success === false) {
    const error = new Error(
      body?.errors?.[0]?.message ?? `Cloudflare API request failed with ${response.status}`
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }

  if (body?.result === undefined) {
    throw new Error("Cloudflare API response did not include result.");
  }

  return body.result;
}
