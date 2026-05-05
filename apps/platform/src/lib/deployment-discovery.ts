import {
  CloudflareApiClient,
  CloudflareApiError,
  inspectCloudflareToken,
  type CloudflareWorkerScriptResult,
  type CloudflareWorkerScriptSettings
} from "./cloudflare-api";
import type { DeploymentRecord } from "./d1";
import type { StarterTemplate } from "./deployment-engine";
import { fingerprintToken } from "./security";

export interface CloudflareDeploymentDiscovery {
  records: DeploymentRecord[];
  accountsScanned: number;
  scriptsScanned: number;
  warnings: string[];
}

interface DiscoveryAccount {
  id: string;
  name?: string;
}

export async function discoverOpenThinkDeploymentsFromCloudflare(input: {
  apiToken: string;
  userId: string;
}): Promise<CloudflareDeploymentDiscovery> {
  const inspection = await inspectCloudflareToken({ apiToken: input.apiToken });
  const tokenFingerprint = await fingerprintToken(input.apiToken);
  const accounts = inspection.accounts.length
    ? inspection.accounts
    : inspection.defaultAccountId
      ? [{ id: inspection.defaultAccountId }]
      : [];
  const records: DeploymentRecord[] = [];
  const warnings: string[] = [];
  let scriptsScanned = 0;

  await Promise.all(
    accounts.map(async (account) => {
      try {
        const discovered = await discoverAccountDeployments({
          account,
          apiToken: input.apiToken,
          userId: input.userId,
          tokenFingerprint
        });
        scriptsScanned += discovered.scriptsScanned;
        records.push(...discovered.records);
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `${account.name ?? account.id}: ${error.message}`
            : `${account.name ?? account.id}: Cloudflare deployment discovery failed.`
        );
      }
    })
  );

  return {
    records,
    accountsScanned: accounts.length,
    scriptsScanned,
    warnings
  };
}

async function discoverAccountDeployments(input: {
  account: DiscoveryAccount;
  apiToken: string;
  userId: string;
  tokenFingerprint: string;
}): Promise<{ records: DeploymentRecord[]; scriptsScanned: number }> {
  const client = new CloudflareApiClient({
    accountId: input.account.id,
    apiToken: input.apiToken
  });
  const scripts = await client.listWorkerScripts();
  const candidates = scripts.filter((script) =>
    scriptNameForResult(script).toLowerCase().startsWith("open-think-")
  );
  const workersSubdomain = await client.getWorkersSubdomain().catch(() => null);
  const records: DeploymentRecord[] = [];

  await Promise.all(
    candidates.map(async (script) => {
      const scriptName = scriptNameForResult(script);
      if (!scriptName) return;
      try {
        const settings = await client.getWorkerScriptSettings(scriptName);
        const record = deploymentRecordFromWorkerSettings({
          settings,
          script,
          scriptName,
          accountId: input.account.id,
          userId: input.userId,
          tokenFingerprint: input.tokenFingerprint,
          workersSubdomain
        });
        if (record) records.push(record);
      } catch (error) {
        if (error instanceof CloudflareApiError && error.status === 404) return;
        throw error;
      }
    })
  );

  return {
    records,
    scriptsScanned: candidates.length
  };
}

function deploymentRecordFromWorkerSettings(input: {
  settings: CloudflareWorkerScriptSettings;
  script: CloudflareWorkerScriptResult;
  scriptName: string;
  accountId: string;
  userId: string;
  tokenFingerprint: string;
  workersSubdomain: string | null;
}): DeploymentRecord | null {
  const bindings = input.settings.bindings ?? [];
  const deploymentId = readBindingText(bindings, "OPEN_THINK_DEPLOYMENT_ID");
  if (!deploymentId) return null;

  const now = new Date().toISOString();
  const agentName = readBindingText(bindings, "OPEN_THINK_AGENT_NAME") ?? input.scriptName;
  const starterTemplate = normalizeStarter(readBindingText(bindings, "OPEN_THINK_STARTER"));
  const accountId = readBindingText(bindings, "OPEN_THINK_CF_ACCOUNT_ID") ?? input.accountId;
  const spendLimitUsd = Number(readBindingText(bindings, "OPEN_THINK_SPEND_LIMIT_USD") ?? 100);
  const workersDevUrl = input.workersSubdomain
    ? `https://${input.scriptName}.${input.workersSubdomain}.workers.dev`
    : `https://${input.scriptName}.workers.dev`;
  const updatedAt = input.script.modified_on ?? input.script.created_on ?? now;
  const resourcePlan = resourcePlanFromSettings({
    bindings,
    accountId,
    scriptName: input.scriptName,
    settings: input.settings,
    workersDevUrl,
    updatedAt
  });

  return {
    id: deploymentId,
    userId: input.userId,
    flow: "self",
    starterTemplate,
    status: "ready",
    agentUrl: workersDevUrl,
    resourcePlan,
    authorization: {
      accountId,
      tokenFingerprint: input.tokenFingerprint,
      spendLimitUsd: Number.isFinite(spendLimitUsd) ? spendLimitUsd : 100,
      termsAcceptedAt: updatedAt,
      tenantKind: "self",
      agentName
    },
    createdAt: input.script.created_on ?? updatedAt,
    updatedAt
  };
}

function resourcePlanFromSettings(input: {
  bindings: Array<Record<string, unknown>>;
  accountId: string;
  scriptName: string;
  settings: CloudflareWorkerScriptSettings;
  workersDevUrl: string;
  updatedAt: string;
}): Record<string, unknown> {
  const d1 = readBinding(input.bindings, "DB");
  const r2 = readBinding(input.bindings, "AGENT_STORAGE");
  const queue = readBinding(input.bindings, "TASK_QUEUE");
  const vectorize = readBinding(input.bindings, "VECTORIZE");
  const resourcePlan: Record<string, unknown> = {
    accountId: input.accountId,
    scriptName: input.scriptName,
    recoveredFromCloudflare: true,
    openThinkRuntime: {
      defaultModel: readBindingText(input.bindings, "OPEN_THINK_DEFAULT_MODEL") ?? "@cf/moonshotai/kimi-k2.6",
      modelProvider: readBindingText(input.bindings, "OPEN_THINK_MODEL_PROVIDER") ?? "workers-ai",
      thinkingLevel: readBindingText(input.bindings, "OPEN_THINK_THINKING_LEVEL") ?? "medium"
    },
    workerDeployment: {
      scriptName: input.scriptName,
      uploadedAt: input.updatedAt,
      url: input.workersDevUrl,
      workersDevUrl: input.workersDevUrl,
      protectedByAccess: true
    },
    wrangler: {
      name: input.scriptName,
      main: "worker.js",
      compatibility_date: input.settings.compatibility_date ?? "2026-05-01",
      compatibility_flags: input.settings.compatibility_flags ?? [
        "nodejs_compat",
        "global_fetch_strictly_public"
      ]
    },
    openThinkUpdate: {
      target: {
        deploymentId: readBindingText(input.bindings, "OPEN_THINK_DEPLOYMENT_ID"),
        accountId: input.accountId,
        scriptName: input.scriptName,
        agentUrl: input.workersDevUrl,
        workerUrl: input.workersDevUrl
      },
      autoUpdate: {
        enabled: false,
        direction: "bidirectional",
        intervalSeconds: 300
      },
      lastAction: "status",
      ...(readBindingText(input.bindings, "OPEN_THINK_SOURCE_SHA")
        ? { lastDeployedSha: readBindingText(input.bindings, "OPEN_THINK_SOURCE_SHA") }
        : {}),
      updatedAt: new Date().toISOString()
    }
  };

  const artifactRemote = readBindingText(input.bindings, "OPEN_THINK_ARTIFACTS_REMOTE");
  const artifactNamespace = readBindingText(input.bindings, "OPEN_THINK_ARTIFACTS_NAMESPACE");
  const artifactRepo = readBindingText(input.bindings, "OPEN_THINK_ARTIFACTS_REPO");
  if (artifactRemote && artifactNamespace && artifactRepo) {
    resourcePlan.openThinkWorkspace = {
      mode: "artifacts-sandbox-workspace",
      artifact: {
        namespace: artifactNamespace,
        repo: artifactRepo,
        remote: artifactRemote,
        defaultBranch: readBindingText(input.bindings, "ARTIFACTS_BRANCH") ?? "main",
        tokenSecretConfigured: Boolean(readBinding(input.bindings, "OPEN_THINK_ARTIFACTS_TOKEN")),
        enabledAt: input.updatedAt
      },
      sandbox: {
        status:
          readBindingText(input.bindings, "OPEN_THINK_SANDBOX_STATUS") === "ready-to-add"
            ? "ready-to-add"
            : "not-configured",
        requiresPaidPlan: true
      },
      containers: {
        status:
          readBindingText(input.bindings, "OPEN_THINK_CONTAINER_STATUS") === "ready-to-add"
            ? "ready-to-add"
            : "not-configured",
        requiresPaidPlan: true
      },
      updatedAt: input.updatedAt
    };
  }

  const d1Id = readString(d1?.id);
  if (d1Id) resourcePlan.d1Database = { id: d1Id, name: readString(d1?.database_name) ?? "DB" };

  const bucketName = readString(r2?.bucket_name);
  if (bucketName) resourcePlan.r2Bucket = { name: bucketName };

  const queueName = readString(queue?.queue_name);
  if (queueName) resourcePlan.queue = { name: queueName };

  const vectorizeName = readString(vectorize?.index_name);
  if (vectorizeName) resourcePlan.vectorizeIndex = { name: vectorizeName };

  return resourcePlan;
}

function scriptNameForResult(script: CloudflareWorkerScriptResult): string {
  return readString(script.id) ?? readString(script.script_name) ?? readString(script.name) ?? "";
}

function readBinding(bindings: Array<Record<string, unknown>>, name: string) {
  return bindings.find((binding) => binding.name === name);
}

function readBindingText(bindings: Array<Record<string, unknown>>, name: string): string | undefined {
  const binding = readBinding(bindings, name);
  return readString(binding?.text) ?? readString(binding?.value);
}

function normalizeStarter(value: string | undefined): StarterTemplate {
  return value === "personal-agent" ? value : "personal-agent";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
