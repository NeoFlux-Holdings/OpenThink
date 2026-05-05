import type { DeploymentRequest, StarterTemplate } from "./deployment-engine";
import { renderAgentWorkerModule } from "./agent-worker-template";
import {
  createGeneratedRuntimePublisher,
  type GeneratedRuntimePublishResult,
  type GeneratedRuntimePublisher
} from "./generated-runtime-publisher";
import { readEnvString } from "./platform-env";
import { platformD1SchemaSql } from "./platform-schema";

export interface CloudflareApiClientOptions {
  accountId: string;
  apiToken: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export interface CloudflareResourcePlan {
  accountId: string;
  scriptName: string;
  generatedRuntime?: GeneratedRuntimePublishResult;
  openThinkWorkspace?: Record<string, unknown>;
  d1Database: {
    name: string;
    id?: string;
  };
  r2Bucket: {
    name: string;
  };
  vectorizeIndex: {
    name: string;
    dimensions: number;
    metric: "cosine" | "euclidean" | "dot-product";
  };
  queue: {
    name: string;
    id?: string;
  };
  workerDeployment?: {
    scriptName: string;
    uploadedAt: string;
    url?: string;
    workersDevUrl?: string;
    customHostname?: string;
    customRouteId?: string;
    dnsRecordId?: string;
    accessApplicationId?: string;
    accessPolicyId?: string;
    protectedByAccess?: boolean;
  };
  wrangler: Record<string, unknown>;
}

export interface CloudflareProvisioningAdapter {
  provision(request: DeploymentRequest, deploymentId: string): Promise<CloudflareResourcePlan>;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message: string }>;
  messages?: string[];
  result?: T;
}

interface CloudflareRequestInit {
  method?: string;
  body?: unknown;
  operation?: string;
  requiredPermission?: string;
  authFailureHint?: string;
}

interface D1DatabaseResult {
  uuid?: string;
  id?: string;
  name: string;
}

interface CloudflareAccountResult {
  id: string;
  name?: string;
}

interface R2BucketResult {
  name: string;
}

interface QueueResult {
  queue_id?: string;
  id?: string;
  queue_name?: string;
  name?: string;
}

interface VectorizeIndexResult {
  name: string;
}

interface WorkerUploadMetadata {
  main_module: string;
  compatibility_date: string;
  compatibility_flags: string[];
  bindings: Array<Record<string, unknown>>;
  keep_bindings?: string[];
}

interface WorkerSubdomainResult {
  enabled: boolean;
  previews_enabled: boolean;
}

interface AccountWorkersSubdomainResult {
  subdomain?: string;
}

interface AccessApplicationResult {
  id?: string;
  aud?: string;
  name?: string;
  domain?: string;
  policies?: Array<{ id?: string; name?: string }>;
}

interface CloudflareUserResult {
  id?: string;
  email?: string;
}

interface CloudflareZoneResult {
  id: string;
  name: string;
  status?: string;
}

interface DnsRecordResult {
  id: string;
  name: string;
  type: string;
  content: string;
}

interface WorkerRouteResult {
  id?: string;
  pattern: string;
  script?: string;
}

export interface CloudflareWorkerScriptResult {
  id?: string;
  script_name?: string;
  name?: string;
  created_on?: string;
  modified_on?: string;
}

export interface CloudflareWorkerScriptSettings {
  bindings?: Array<Record<string, unknown>>;
  compatibility_date?: string;
  compatibility_flags?: string[];
  usage_model?: string;
  logpush?: boolean;
}

interface ArtifactRepoResult {
  id: string;
  name: string;
  description: string | null;
  default_branch: string;
  remote: string;
  token?: string;
}

interface ArtifactTokenResult {
  id: string;
  plaintext: string;
  scope: "read" | "write";
  expires_at: string;
}

export interface CloudflareTokenInspection {
  userEmail?: string;
  accounts: Array<{ id: string; name?: string }>;
  zones: Array<{ id: string; name: string; status?: string }>;
  defaultAccountId?: string;
  defaultAccessEmail?: string;
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly operation?: string,
    readonly requiredPermission?: string
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export class CloudflareConfigurationError extends Error {
  constructor(
    message: string,
    readonly missing: string[]
  ) {
    super(message);
    this.name = "CloudflareConfigurationError";
  }
}

export class CloudflareApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: CloudflareApiClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.cloudflare.com/client/v4";
    this.fetcher = options.fetcher ?? fetch;
  }

  get accountId(): string {
    return this.options.accountId;
  }

  async verifyToken(): Promise<void> {
    try {
      await this.request<unknown>("/user/tokens/verify", {
        operation: "Verify Cloudflare API token",
        authFailureHint:
          "The token was rejected before permission checks. Copy the token value immediately after creating it, not the token name or id."
      });
    } catch (error) {
      if (error instanceof CloudflareApiError) {
        throw error;
      }
      throw error;
    }
  }

  async verifyAccountAccess(): Promise<void> {
    await this.request<unknown>(`/accounts/${this.options.accountId}`, {
      operation: "Verify Cloudflare account access",
      requiredPermission: "Account Settings Read",
      authFailureHint:
        "The token is valid, but it is not allowed to access this account id. Recreate it for this account or for all accounts."
    });
  }

  async verifyProvisioningPermissions(): Promise<void> {
    await this.request<unknown>(
      `/accounts/${this.options.accountId}/d1/database`,
      {
        operation: "Verify D1 permission",
        requiredPermission: "D1 Write"
      }
    );
    await this.request<unknown>(
      `/accounts/${this.options.accountId}/r2/buckets`,
      {
        operation: "Verify R2 permission",
        requiredPermission: "Workers R2 Storage Write",
        authFailureHint:
          "Open the token in Cloudflare Dashboard and manually add Account > Workers R2 Storage > Edit or Write. The generated token URL may not preselect R2."
      }
    );
    await this.request<unknown>(
      `/accounts/${this.options.accountId}/queues`,
      {
        operation: "Verify Queues permission",
        requiredPermission: "Queues Write"
      }
    );
    await this.request<unknown>(
      `/accounts/${this.options.accountId}/vectorize/v2/indexes`,
      {
        operation: "Verify Vectorize permission",
        requiredPermission: "Vectorize Write"
      }
    );
  }

  async verifyCustomDomainPermissions(zoneId: string): Promise<void> {
    await this.request<unknown>(`/zones/${zoneId}`, {
      operation: "Verify DNS zone access",
      requiredPermission: "Zone Read"
    });
    await this.request<unknown>(`/zones/${zoneId}/dns_records?per_page=1`, {
      operation: "Verify DNS record access",
      requiredPermission: "DNS Write"
    });
    await this.request<unknown>(`/zones/${zoneId}/workers/routes?per_page=1`, {
      operation: "Verify Workers Routes access",
      requiredPermission: "Workers Routes Write"
    });
  }

  async ensureD1Database(name: string): Promise<D1DatabaseResult> {
    const list = await this.request<D1DatabaseResult[]>(
      `/accounts/${this.options.accountId}/d1/database`,
      {
        operation: "List D1 databases",
        requiredPermission: "D1 Write"
      }
    );
    const existing = list.find((database) => database.name === name);
    if (existing) return existing;

    return this.request<D1DatabaseResult>(
      `/accounts/${this.options.accountId}/d1/database`,
      {
        method: "POST",
        body: { name },
        operation: "Create D1 database",
        requiredPermission: "D1 Write"
      }
    );
  }

  async ensureR2Bucket(name: string): Promise<R2BucketResult> {
    const found = await this.tryRequest<R2BucketResult>(
      `/accounts/${this.options.accountId}/r2/buckets/${name}`,
      {
        operation: "Read R2 bucket",
        requiredPermission: "Workers R2 Storage Write"
      }
    );
    if (found) return found;

    return this.request<R2BucketResult>(
      `/accounts/${this.options.accountId}/r2/buckets`,
      {
        method: "POST",
        body: { name },
        operation: "Create R2 bucket",
        requiredPermission: "Workers R2 Storage Write"
      }
    );
  }

  async ensureQueue(name: string): Promise<QueueResult> {
    const list = await this.request<QueueResult[]>(
      `/accounts/${this.options.accountId}/queues`,
      {
        operation: "List Queues",
        requiredPermission: "Queues Write"
      }
    );
    const existing = list.find((queue) => queue.queue_name === name || queue.name === name);
    if (existing) return existing;

    return this.request<QueueResult>(
      `/accounts/${this.options.accountId}/queues`,
      {
        method: "POST",
        body: { queue_name: name },
        operation: "Create Queue",
        requiredPermission: "Queues Write"
      }
    );
  }

  async ensureVectorizeIndex(
    name: string,
    dimensions = 1536,
    metric: "cosine" | "euclidean" | "dot-product" = "cosine"
  ): Promise<VectorizeIndexResult> {
    const found = await this.tryRequest<VectorizeIndexResult>(
      `/accounts/${this.options.accountId}/vectorize/v2/indexes/${name}`,
      {
        operation: "Read Vectorize index",
        requiredPermission: "Vectorize Write"
      }
    );
    if (found) return found;

    return this.request<VectorizeIndexResult>(
      `/accounts/${this.options.accountId}/vectorize/v2/indexes`,
      {
        method: "POST",
        body: {
          name,
          config: { dimensions, metric },
          description: "open-think agent semantic memory"
        },
        operation: "Create Vectorize index",
        requiredPermission: "Vectorize Write"
      }
    );
  }

  async executeD1Sql(databaseId: string, sql: string): Promise<unknown> {
    const batch = splitSqlStatements(sql).map((statement) => ({ sql: statement }));
    return this.request<unknown>(
      `/accounts/${this.options.accountId}/d1/database/${databaseId}/query`,
      {
        method: "POST",
        body: { batch },
        operation: "Apply D1 schema",
        requiredPermission: "D1 Write"
      }
    );
  }

  async ensureArtifactRepoWithWriteToken(input: {
    namespace: string;
    repoName: string;
    description?: string;
    defaultBranch?: string;
    tokenTtlSeconds?: number;
  }): Promise<{
    id: string;
    name: string;
    remote: string;
    token: string;
    defaultBranch: string;
    expiresAt?: string;
  }> {
    const repoPath = `/accounts/${this.options.accountId}/artifacts/namespaces/${encodeURIComponent(input.namespace)}/repos`;
    let repo: ArtifactRepoResult;

    try {
      repo = await this.request<ArtifactRepoResult>(repoPath, {
        method: "POST",
        body: {
          name: input.repoName,
          description: input.description,
          default_branch: input.defaultBranch ?? "main",
          read_only: false
        },
        operation: "Create Artifacts repo",
        requiredPermission: "Artifacts Edit"
      });
    } catch (error) {
      if (!(error instanceof CloudflareApiError) || error.status !== 409) {
        throw error;
      }
      repo = await this.request<ArtifactRepoResult>(
        `${repoPath}/${encodeURIComponent(input.repoName)}`,
        {
          operation: "Read Artifacts repo",
          requiredPermission: "Artifacts Read"
        }
      );
    }

    if (repo.token) {
      return {
        id: repo.id,
        name: repo.name,
        remote: repo.remote,
        token: repo.token,
        defaultBranch: repo.default_branch
      };
    }

    const token = await this.request<ArtifactTokenResult>(
      `/accounts/${this.options.accountId}/artifacts/namespaces/${encodeURIComponent(input.namespace)}/tokens`,
      {
        method: "POST",
        body: {
          repo: input.repoName,
          scope: "write",
          ttl: input.tokenTtlSeconds ?? 86400
        },
        operation: "Create Artifacts repo token",
        requiredPermission: "Artifacts Edit"
      }
    );

    return {
      id: repo.id,
      name: repo.name,
      remote: repo.remote,
      token: token.plaintext,
      defaultBranch: repo.default_branch,
      expiresAt: token.expires_at
    };
  }

  async uploadWorkerModule(input: {
    scriptName: string;
    moduleName: string;
    moduleCode: string;
    metadata: WorkerUploadMetadata;
  }): Promise<void> {
    const form = new FormData();
    form.set("metadata", JSON.stringify(input.metadata));
    form.set(
      input.moduleName,
      new Blob([input.moduleCode], { type: "application/javascript+module" }),
      input.moduleName
    );

    const uploadUrl = new URL(
      `${this.baseUrl}/accounts/${this.options.accountId}/workers/scripts/${input.scriptName}`
    );
    if (input.metadata.keep_bindings?.length) {
      uploadUrl.searchParams.set("bindings_inherit", "strict");
    }

    const response = await this.fetcher(
      uploadUrl.toString(),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.options.apiToken}`
        },
        body: form
      }
    );

    const body = (await response.json().catch(() => null)) as
      | CloudflareEnvelope<unknown>
      | null;

    if (!response.ok || body?.success === false) {
      const cloudflareMessage =
        body?.errors?.[0]?.message ?? `Worker script upload failed with ${response.status}`;
      throw new CloudflareApiError(
        formatCloudflareErrorMessage({
          operation: "Upload Worker script",
          cloudflareMessage,
          requiredPermission: "Workers Scripts Write"
        }),
        response.status,
        body,
        "Upload Worker script",
        "Workers Scripts Write"
      );
    }
  }

  async listWorkerScripts(): Promise<CloudflareWorkerScriptResult[]> {
    return this.request<CloudflareWorkerScriptResult[]>(
      `/accounts/${this.options.accountId}/workers/scripts?per_page=100`,
      {
        operation: "List Worker scripts",
        requiredPermission: "Workers Scripts Write"
      }
    );
  }

  async getWorkerScriptSettings(scriptName: string): Promise<CloudflareWorkerScriptSettings> {
    return this.request<CloudflareWorkerScriptSettings>(
      `/accounts/${this.options.accountId}/workers/scripts/${scriptName}/settings`,
      {
        operation: "Read Worker script settings",
        requiredPermission: "Workers Scripts Write"
      }
    );
  }

  async getWorkersSubdomain(): Promise<string | null> {
    const result = await this.tryRequest<AccountWorkersSubdomainResult>(
      `/accounts/${this.options.accountId}/workers/subdomain`,
      {
        operation: "Read Workers account subdomain",
        requiredPermission: "Workers Scripts Read or Workers Scripts Write"
      }
    );
    return result?.subdomain ?? null;
  }

  async enableWorkerSubdomain(scriptName: string): Promise<WorkerSubdomainResult> {
    return this.request<WorkerSubdomainResult>(
      `/accounts/${this.options.accountId}/workers/scripts/${scriptName}/subdomain`,
      {
        method: "POST",
        body: {
          enabled: true,
          previews_enabled: true
        },
        operation: "Enable workers.dev route",
        requiredPermission: "Workers Scripts Write"
      }
    );
  }

  async disableWorkerSubdomain(scriptName: string): Promise<void> {
    await this.request<WorkerSubdomainResult>(
      `/accounts/${this.options.accountId}/workers/scripts/${scriptName}/subdomain`,
      {
        method: "DELETE",
        operation: "Disable workers.dev route",
        requiredPermission: "Workers Scripts Write"
      }
    );
  }

  async createAccessApplication(input: {
    name: string;
    domain: string;
    allowedEmails: string[];
  }): Promise<AccessApplicationResult> {
    if (input.allowedEmails.length === 0) {
      throw new CloudflareConfigurationError(
        "Cloudflare Access protection requires at least one owner login email.",
        ["accessAllowedEmail"]
      );
    }

    try {
      return await this.createAccessApplicationRecord(input);
    } catch (error) {
      if (!isAccessApplicationAlreadyExists(error)) throw error;

      const existingApps = await this.listAccessApplications();
      const domainMatch = existingApps.find(
        (app) => app.domain?.toLowerCase() === input.domain.toLowerCase()
      );
      if (domainMatch?.id) {
        return this.updateAccessApplicationRecord(domainMatch.id, {
          ...input,
          name: domainMatch.name ?? input.name
        });
      }

      return this.createAccessApplicationRecord({
        ...input,
        name: uniqueAccessApplicationName(input.name, input.domain)
      });
    }
  }

  async listAccessApplications(): Promise<AccessApplicationResult[]> {
    return this.request<AccessApplicationResult[]>(
      `/accounts/${this.options.accountId}/access/apps?per_page=100`,
      {
        operation: "List Cloudflare Access applications",
        requiredPermission: "Access Apps and Policies Write"
      }
    );
  }

  private createAccessApplicationRecord(input: {
    name: string;
    domain: string;
    allowedEmails: string[];
  }): Promise<AccessApplicationResult> {
    return this.request<AccessApplicationResult>(
      `/accounts/${this.options.accountId}/access/apps`,
      {
        method: "POST",
        body: accessApplicationBody(input),
        operation: "Create Cloudflare Access application",
        requiredPermission: "Access Apps and Policies Write"
      }
    );
  }

  private updateAccessApplicationRecord(
    applicationId: string,
    input: {
      name: string;
      domain: string;
      allowedEmails: string[];
    }
  ): Promise<AccessApplicationResult> {
    return this.request<AccessApplicationResult>(
      `/accounts/${this.options.accountId}/access/apps/${applicationId}`,
      {
        method: "PUT",
        body: accessApplicationBody(input),
        operation: "Update existing Cloudflare Access application",
        requiredPermission: "Access Apps and Policies Write"
      }
    );
  }

  async upsertCnameRecord(input: {
    zoneId: string;
    hostname: string;
    target: string;
  }): Promise<DnsRecordResult> {
    const name = input.hostname.toLowerCase();
    const list = await this.request<DnsRecordResult[]>(
      `/zones/${input.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`,
      {
        operation: "List DNS records",
        requiredPermission: "DNS Write"
      }
    );
    const existing = list.find((record) => record.name === name);
    const body = {
      type: "CNAME",
      name,
      content: input.target,
      ttl: 1,
      proxied: true,
      comment: "Managed by open-think personal agent deployment"
    };

    if (existing) {
      return this.request<DnsRecordResult>(
        `/zones/${input.zoneId}/dns_records/${existing.id}`,
        {
          method: "PUT",
          body,
          operation: "Update DNS CNAME record",
          requiredPermission: "DNS Write"
        }
      );
    }

    return this.request<DnsRecordResult>(`/zones/${input.zoneId}/dns_records`, {
      method: "POST",
      body,
      operation: "Create DNS CNAME record",
      requiredPermission: "DNS Write"
    });
  }

  async ensureWorkerRoute(input: {
    zoneId: string;
    hostname: string;
    scriptName: string;
  }): Promise<WorkerRouteResult> {
    const pattern = `${input.hostname.toLowerCase()}/*`;
    const list = await this.request<WorkerRouteResult[]>(
      `/zones/${input.zoneId}/workers/routes?per_page=100`,
      {
        operation: "List Workers routes",
        requiredPermission: "Workers Routes Write"
      }
    );
    const existing = list.find((route) => route.pattern === pattern);
    const body = { pattern, script: input.scriptName };

    if (existing?.id) {
      return this.request<WorkerRouteResult>(
        `/zones/${input.zoneId}/workers/routes/${existing.id}`,
        {
          method: "PUT",
          body,
          operation: "Update Workers route",
          requiredPermission: "Workers Routes Write"
        }
      );
    }

    return this.request<WorkerRouteResult>(`/zones/${input.zoneId}/workers/routes`, {
      method: "POST",
      body,
      operation: "Create Workers route",
      requiredPermission: "Workers Routes Write"
    });
  }

  private async tryRequest<T>(
    path: string,
    init?: CloudflareRequestInit
  ): Promise<T | null> {
    try {
      return await this.request<T>(path, init);
    } catch (error) {
      if (error instanceof CloudflareApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async request<T>(
    path: string,
    init: CloudflareRequestInit = {}
  ): Promise<T> {
    const requestInit: RequestInit = {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.options.apiToken}`,
        "Content-Type": "application/json"
      }
    };

    if (init.body !== undefined) {
      requestInit.body = JSON.stringify(init.body);
    }

    const response = await this.fetcher(`${this.baseUrl}${path}`, requestInit);

    const body = (await response.json().catch(() => null)) as
      | CloudflareEnvelope<T>
      | null;

    if (!response.ok || body?.success === false) {
      const cloudflareMessage =
        body?.errors?.[0]?.message ?? `Cloudflare API failed with ${response.status}`;
      throw new CloudflareApiError(
        formatCloudflareErrorMessage(
          cloudflareErrorContext(init, cloudflareMessage)
        ),
        response.status,
        body,
        init.operation,
        init.requiredPermission
      );
    }

    if (!body || body.result === undefined) {
      throw new CloudflareApiError(
        formatCloudflareErrorMessage(
          cloudflareErrorContext(
            init,
            "Cloudflare API response did not include a result."
          )
        ),
        response.status,
        body,
        init.operation,
        init.requiredPermission
      );
    }

    return body.result;
  }
}

export async function resolveCloudflareAccountIdFromToken(input: {
  apiToken: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const baseUrl = input.baseUrl ?? "https://api.cloudflare.com/client/v4";
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`${baseUrl}/accounts?per_page=50`, {
    headers: {
      Authorization: `Bearer ${input.apiToken}`,
      "Content-Type": "application/json"
    }
  });
  const body = (await response.json().catch(() => null)) as
    | CloudflareEnvelope<CloudflareAccountResult[]>
    | null;

  if (!response.ok || body?.success === false) {
    const cloudflareMessage =
      body?.errors?.[0]?.message ?? `Cloudflare API failed with ${response.status}`;
    throw new CloudflareApiError(
      formatCloudflareErrorMessage({
        operation: "Resolve Cloudflare account from token",
        cloudflareMessage,
        requiredPermission: "Account Settings Read"
      }),
      response.status,
      body,
      "Resolve Cloudflare account from token",
      "Account Settings Read"
    );
  }

  const accounts = body?.result ?? [];
  if (accounts.length === 1) {
    const account = accounts.at(0);
    if (account) return account.id;
  }

  if (accounts.length === 0) {
    throw new CloudflareConfigurationError(
      "The Cloudflare token did not expose any accounts. Enter the target account id or recreate the token with account access.",
      ["cloudflareAccountId"]
    );
  }

  throw new CloudflareConfigurationError(
    `The Cloudflare token can access ${accounts.length} accounts. Enter the target Cloudflare account id to disambiguate.`,
    ["cloudflareAccountId"]
  );
}

export async function inspectCloudflareToken(input: {
  apiToken: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}): Promise<CloudflareTokenInspection> {
  const baseUrl = input.baseUrl ?? "https://api.cloudflare.com/client/v4";
  const fetcher = input.fetcher ?? fetch;
  const request = async <T>(path: string): Promise<T> => {
    const response = await fetcher(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        "Content-Type": "application/json"
      }
    });
    const body = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null;
    if (!response.ok || body?.success === false || body?.result === undefined) {
      const cloudflareMessage =
        body?.errors?.[0]?.message ?? `Cloudflare API failed with ${response.status}`;
      throw new CloudflareApiError(
        formatCloudflareErrorMessage({
          operation: "Verify Cloudflare token",
          cloudflareMessage,
          requiredPermission: "User Details Read, Account Settings Read, and Zone Read"
        }),
        response.status,
        body,
        "Verify Cloudflare token"
      );
    }
    return body.result;
  };

  const [user, accounts, zones] = await Promise.all([
    request<CloudflareUserResult>("/user").catch((): CloudflareUserResult => ({})),
    request<CloudflareAccountResult[]>("/accounts?per_page=50"),
    request<CloudflareZoneResult[]>("/zones?per_page=50").catch(() => [])
  ]);
  const defaultAccountId = accounts.length === 1 ? accounts[0]?.id : undefined;
  return {
    ...(user.email ? { userEmail: user.email } : {}),
    accounts: accounts.map((account) => ({
      id: account.id,
      ...(account.name ? { name: account.name } : {})
    })),
    zones: zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      ...(zone.status ? { status: zone.status } : {})
    })),
    ...(defaultAccountId ? { defaultAccountId } : {}),
    ...(user.email ? { defaultAccessEmail: user.email } : {})
  };
}

export class CloudflareRestProvisioningAdapter implements CloudflareProvisioningAdapter {
  private readonly runtimePublisher: GeneratedRuntimePublisher;

  constructor(
    private readonly client: CloudflareApiClient,
    options: {
      env?: Record<string, unknown>;
      runtimePublisher?: GeneratedRuntimePublisher;
    } = {}
  ) {
    this.runtimePublisher =
      options.runtimePublisher ?? createGeneratedRuntimePublisher(this.client, options.env);
  }

  async provision(
    request: DeploymentRequest,
    deploymentId: string
  ): Promise<CloudflareResourcePlan> {
    const names = resourceNames(request, deploymentId);

    await this.client.verifyToken();
    await this.client.verifyAccountAccess();
    await this.client.verifyProvisioningPermissions();
    const customDomain = normalizeCustomDomain(request.customDomain);
    if (customDomain) {
      await this.client.verifyCustomDomainPermissions(customDomain.zoneId);
    }

    const [d1Database, r2Bucket, queue, vectorizeIndex] = await Promise.all([
      this.client.ensureD1Database(names.database),
      this.client.ensureR2Bucket(names.bucket),
      this.client.ensureQueue(names.queue),
      this.client.ensureVectorizeIndex(names.vectorize)
    ]);

    const d1Plan: CloudflareResourcePlan["d1Database"] = {
      name: d1Database.name
    };
    const d1Id = d1Database.uuid ?? d1Database.id;
    if (!d1Id) {
      throw new CloudflareApiError(
        `D1 database ${d1Database.name} did not include an id in the Cloudflare API response.`,
        502,
        d1Database
      );
    }
    if (d1Id) d1Plan.id = d1Id;

    const queuePlan: CloudflareResourcePlan["queue"] = {
      name: queue.queue_name ?? queue.name ?? names.queue
    };
    const queueId = queue.queue_id ?? queue.id;
    if (queueId) queuePlan.id = queueId;

    await this.client.executeD1Sql(d1Id, platformD1SchemaSql);

    const wrangler = generateWranglerPlan(request.starterTemplate, deploymentId, {
      databaseName: d1Database.name,
      databaseId: d1Id,
      bucketName: r2Bucket.name,
      queueName: queue.queue_name ?? queue.name ?? names.queue,
      vectorizeName: vectorizeIndex.name,
      scriptName: names.script
    });

    const sourceSha =
      readEnvString(process.env, "OPEN_THINK_SOURCE_SHA") ??
      readEnvString(process.env, "GITHUB_SHA");
    const workerUploadMetadata = generateWorkerUploadMetadata({
      deploymentId,
      starterTemplate: request.starterTemplate,
      agentName: request.agentName?.trim() || "Personal Agent",
      spendLimitUsd: request.spendLimitUsd ?? 100,
      scriptName: names.script,
      defaultModel: request.defaultModel ?? "@cf/moonshotai/kimi-k2.6",
      modelProvider: request.modelProvider ?? inferModelProvider(request.defaultModel),
      thinkingLevel: request.thinkingLevel ?? "medium",
      cloudflareAccountId: request.cloudflareAccountId?.trim() || this.clientAccountId,
      ...(sourceSha ? { sourceSha } : {}),
      ...(request.cfApiToken ? { cloudflareApiToken: request.cfApiToken } : {}),
      ...(request.providerKeys?.openRouterApiKey
        ? { openRouterApiKey: request.providerKeys.openRouterApiKey }
        : {}),
      ...(request.providerKeys?.anthropicApiKey
        ? { anthropicApiKey: request.providerKeys.anthropicApiKey }
        : {}),
      ...(request.providerKeys?.openAiApiKey ? { openAiApiKey: request.providerKeys.openAiApiKey } : {}),
      databaseId: d1Id,
      bucketName: r2Bucket.name,
      queueName: queue.queue_name ?? queue.name ?? names.queue,
      vectorizeName: vectorizeIndex.name
    });

    const runtimePublishInput: Parameters<typeof this.runtimePublisher.publish>[0] = {
      request,
      deploymentId,
      accountId: this.clientAccountId,
      scriptName: names.script,
      bindings: {
        scriptName: names.script,
        databaseName: d1Database.name,
        databaseId: d1Id,
        bucketName: r2Bucket.name,
        queueName: queue.queue_name ?? queue.name ?? names.queue,
        vectorizeName: vectorizeIndex.name
      },
      rawWorker: {
        moduleName: "worker.js",
        moduleCode: renderAgentWorkerModule({ request, deploymentId, scriptName: names.script }),
        metadata: workerUploadMetadata
      },
      wrangler
    };
    const runtimeApiToken = request.cfApiToken?.trim();
    if (runtimeApiToken) {
      runtimePublishInput.apiToken = runtimeApiToken;
    }
    const generatedRuntime = await this.runtimePublisher.publish(runtimePublishInput);
    const openThinkWorkspace = generatedRuntime.artifact
      ? {
          mode: "artifacts-sandbox-workspace",
          artifact: {
            namespace: generatedRuntime.artifact.namespace,
            repo: generatedRuntime.artifact.repo,
            remote: generatedRuntime.artifact.remote,
            defaultBranch: generatedRuntime.artifact.defaultBranch,
            tokenSecretConfigured: false,
            ...(generatedRuntime.artifact.tokenExpiresAt
              ? { tokenExpiresAt: generatedRuntime.artifact.tokenExpiresAt }
              : {}),
            enabledAt: new Date().toISOString()
          },
          sandbox: {
            status: "ready-to-add",
            requiresPaidPlan: true
          },
          containers: {
            status: "ready-to-add",
            requiresPaidPlan: true
          },
          updatedAt: new Date().toISOString()
        }
      : undefined;

    await this.client.enableWorkerSubdomain(names.script);
    const workersSubdomain = await this.client.getWorkersSubdomain();
    if (!workersSubdomain) {
      await this.client.disableWorkerSubdomain(names.script).catch(() => undefined);
      throw new CloudflareApiError(
        "Cloudflare did not return a workers.dev account subdomain, so the Worker could not be locked behind Access.",
        502
      );
    }

    const workersDevUrl = `https://${names.script}.${workersSubdomain}.workers.dev`;
    const workerHost = customDomain?.hostname ?? new URL(workersDevUrl).hostname;
    const workerUrl = customDomain ? `https://${customDomain.hostname}` : workersDevUrl;
    let dnsRecord: DnsRecordResult | undefined;
    let workerRoute: WorkerRouteResult | undefined;

    if (customDomain) {
      dnsRecord = await this.client.upsertCnameRecord({
        zoneId: customDomain.zoneId,
        hostname: customDomain.hostname,
        target: `${names.script}.${workersSubdomain}.workers.dev`
      });
      workerRoute = await this.client.ensureWorkerRoute({
        zoneId: customDomain.zoneId,
        hostname: customDomain.hostname,
        scriptName: names.script
      });
    }

    let accessApplication: AccessApplicationResult;

    try {
      accessApplication = await this.client.createAccessApplication({
        name: request.agentName?.trim() || names.script,
        domain: workerHost,
        allowedEmails: accessEmailsForRequest(request)
      });
    } catch (error) {
      await this.client.disableWorkerSubdomain(names.script).catch(() => undefined);
      throw error;
    }

    const workerDeployment: NonNullable<CloudflareResourcePlan["workerDeployment"]> = {
      scriptName: names.script,
      uploadedAt: new Date().toISOString(),
      url: workerUrl,
      workersDevUrl,
      protectedByAccess: Boolean(accessApplication.id)
    };
    if (customDomain) workerDeployment.customHostname = customDomain.hostname;
    if (dnsRecord?.id) workerDeployment.dnsRecordId = dnsRecord.id;
    if (workerRoute?.id) workerDeployment.customRouteId = workerRoute.id;
    if (accessApplication?.id) workerDeployment.accessApplicationId = accessApplication.id;
    const accessPolicyId = accessApplication?.policies?.[0]?.id;
    if (accessPolicyId) workerDeployment.accessPolicyId = accessPolicyId;

    return {
      accountId: this.clientAccountId,
      scriptName: names.script,
      generatedRuntime,
      ...(openThinkWorkspace ? { openThinkWorkspace } : {}),
      d1Database: d1Plan,
      r2Bucket: {
        name: r2Bucket.name
      },
      vectorizeIndex: {
        name: vectorizeIndex.name,
        dimensions: 1536,
        metric: "cosine"
      },
      queue: queuePlan,
      workerDeployment,
      wrangler
    };
  }

  private get clientAccountId(): string {
    return this.client.accountId;
  }
}

export function provisioningAdapterFromEnv(
  request: DeploymentRequest,
  env: Record<string, unknown> = process.env
): CloudflareProvisioningAdapter {
  const userOwnedFlow = request.flow === "self" || request.flow === "agent" || request.flow === "button";
  const accountId = userOwnedFlow
    ? request.cloudflareAccountId
    : request.partnerAccountId ?? readEnvString(env, "CLOUDFLARE_ACCOUNT_ID");
  const apiToken = userOwnedFlow
    ? request.cfApiToken
    : request.cfApiToken ?? readEnvString(env, "CLOUDFLARE_API_TOKEN");
  const missing: string[] = [];

  if (!accountId) {
    missing.push(userOwnedFlow ? "cloudflareAccountId" : "CLOUDFLARE_ACCOUNT_ID or partnerAccountId");
  }

  if (!apiToken) {
    missing.push(userOwnedFlow ? "cfApiToken" : "CLOUDFLARE_API_TOKEN or request cfApiToken");
  }

  if (missing.length > 0 || !accountId || !apiToken) {
    throw new CloudflareConfigurationError(
      `Cloudflare provisioning requires ${missing.join(", ")}.`,
      missing
    );
  }

  const resolvedAccountId = accountId;
  const resolvedApiToken = apiToken;

  return new CloudflareRestProvisioningAdapter(
    new CloudflareApiClient({
      accountId: resolvedAccountId,
      apiToken: resolvedApiToken
    }),
    { env }
  );
}

function resourceNames(request: DeploymentRequest, deploymentId: string) {
  const agent = sanitizeName(request.agentName?.trim() || "personal-agent").slice(0, 32);
  const suffix = deploymentId.replace(/^agent-/, "").slice(0, 8);
  const base = sanitizeName(`${agent}-${suffix}`);

  return {
    script: `open-think-${base}`,
    database: `open-think-${base}-db`,
    bucket: `open-think-${base}-artifacts`,
    queue: `open-think-${base}-tasks`,
    vectorize: `open-think-${base}-memory`
  };
}

function accessEmailsForRequest(request: DeploymentRequest): string[] {
  return Array.from(
    new Set(
      [
        request.accessAllowedEmail,
        ...(request.accessAdditionalEmails ?? [])
      ]
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    )
  );
}

function accessApplicationBody(input: {
  name: string;
  domain: string;
  allowedEmails: string[];
}): Record<string, unknown> {
  const include = input.allowedEmails.map((email) => ({
    email: { email }
  }));

  return {
    type: "self_hosted",
    name: input.name,
    domain: input.domain,
    session_duration: "24h",
    app_launcher_visible: true,
    auto_redirect_to_identity: false,
    policies: [
      {
        name: `${input.name} owner access`,
        decision: "allow",
        precedence: 1,
        include
      }
    ]
  };
}

function isAccessApplicationAlreadyExists(error: unknown): boolean {
  if (!(error instanceof CloudflareApiError) || error.status !== 409) return false;
  const details = error.details as CloudflareEnvelope<unknown> | undefined;
  return Boolean(
    details?.errors?.some((item) =>
      item.message.toLowerCase().includes("application_already_exists")
    ) || error.message.toLowerCase().includes("application_already_exists")
  );
}

function uniqueAccessApplicationName(name: string, domain: string): string {
  const suffix = domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${name} ${suffix || "agent"}`.slice(0, 80);
}

function normalizeCustomDomain(
  value: DeploymentRequest["customDomain"]
): { hostname: string; zoneId: string } | null {
  if (!value?.enabled) return null;
  const hostname = value.hostname?.trim().toLowerCase();
  const zoneId = value.zoneId?.trim();
  if (!hostname || !zoneId) return null;
  return { hostname, zoneId };
}

function inferModelProvider(model: string | undefined): "workers-ai" | "openrouter" | "anthropic" | "openai" {
  if (!model || model.startsWith("@cf/")) return "workers-ai";
  if (model.startsWith("openrouter/")) return "openrouter";
  if (model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("openai/")) return "openai";
  return "workers-ai";
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function generateWranglerPlan(
  starterTemplate: StarterTemplate,
  deploymentId: string,
  names: {
    databaseName: string;
    databaseId: string;
    bucketName: string;
    queueName: string;
    vectorizeName: string;
    scriptName: string;
  }
): Record<string, unknown> {
  return {
    name: names.scriptName,
    main: "worker.js",
    compatibility_date: "2026-05-01",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    ai: { binding: "AI" },
    durable_objects: {
      bindings: [
        { name: "AGENT_DO", class_name: "AgentDO" },
        { name: "CHAT_DO", class_name: "ChatDO" },
        { name: "TERMINAL_DO", class_name: "TerminalDO" }
      ]
    },
    migrations: [
      {
        tag: `${deploymentId}-v1`,
        new_sqlite_classes: ["AgentDO", "ChatDO", "TerminalDO"]
      }
    ],
    r2_buckets: [
      {
        binding: "AGENT_STORAGE",
        bucket_name: names.bucketName
      }
    ],
    d1_databases: [
      {
        binding: "DB",
        database_name: names.databaseName,
        database_id: names.databaseId
      }
    ],
    vectorize: [
      {
        binding: "VECTORIZE",
        index_name: names.vectorizeName
      }
    ],
    queues: {
      producers: [
        {
          binding: "TASK_QUEUE",
          queue: names.queueName
        }
      ]
    },
    vars: {
      OPEN_THINK_DEPLOYMENT_ID: deploymentId,
      OPEN_THINK_STARTER: starterTemplate
    }
  };
}

function generateWorkerUploadMetadata(input: {
  deploymentId: string;
  starterTemplate: StarterTemplate;
  agentName: string;
  spendLimitUsd: number;
  scriptName: string;
  defaultModel: string;
  modelProvider: "workers-ai" | "openrouter" | "anthropic" | "openai";
  thinkingLevel: "low" | "medium" | "high" | "xhigh";
  cloudflareAccountId: string;
  cloudflareApiToken?: string;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  openAiApiKey?: string;
  sourceSha?: string;
  databaseId: string;
  bucketName: string;
  queueName: string;
  vectorizeName: string;
}): WorkerUploadMetadata {
  return {
    main_module: "worker.js",
    compatibility_date: "2026-05-01",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    bindings: [
      { type: "ai", name: "AI" },
      { type: "d1", name: "DB", id: input.databaseId },
      { type: "r2_bucket", name: "AGENT_STORAGE", bucket_name: input.bucketName },
      { type: "queue", name: "TASK_QUEUE", queue_name: input.queueName },
      { type: "vectorize", name: "VECTORIZE", index_name: input.vectorizeName },
      {
        type: "plain_text",
        name: "OPEN_THINK_DEPLOYMENT_ID",
        text: input.deploymentId
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_STARTER",
        text: input.starterTemplate
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_AGENT_NAME",
        text: input.agentName
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_SPEND_LIMIT_USD",
        text: String(input.spendLimitUsd)
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_DEFAULT_MODEL",
        text: input.defaultModel
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_MODEL_PROVIDER",
        text: input.modelProvider
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_THINKING_LEVEL",
        text: input.thinkingLevel
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_SCRIPT_NAME",
        text: input.scriptName
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_CF_ACCOUNT_ID",
        text: input.cloudflareAccountId
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_UPDATE_REPOSITORY",
        text: "NeoFlux-Holdings/OpenThink"
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_UPDATE_BRANCH",
        text: "main"
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_UPDATE_BUNDLE_PATH",
        text: "dist/worker.js"
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_WORKSPACE_MODE",
        text: "basic-github-updates"
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_SANDBOX_STATUS",
        text: "not-configured"
      },
      {
        type: "plain_text",
        name: "OPEN_THINK_CONTAINER_STATUS",
        text: "not-configured"
      },
      ...(input.sourceSha
        ? [
            {
              type: "plain_text",
              name: "OPEN_THINK_SOURCE_SHA",
              text: input.sourceSha
            }
          ]
        : []),
      ...(input.cloudflareApiToken
        ? [
            {
              type: "secret_text",
              name: "OPEN_THINK_CF_API_TOKEN",
              text: input.cloudflareApiToken
            }
          ]
        : []),
      ...(input.openRouterApiKey
        ? [
            {
              type: "secret_text",
              name: "OPENROUTER_API_KEY",
              text: input.openRouterApiKey
            }
          ]
        : []),
      ...(input.anthropicApiKey
        ? [
            {
              type: "secret_text",
              name: "ANTHROPIC_API_KEY",
              text: input.anthropicApiKey
            }
          ]
        : []),
      ...(input.openAiApiKey
        ? [
            {
              type: "secret_text",
              name: "OPENAI_API_KEY",
              text: input.openAiApiKey
            }
          ]
        : [])
    ],
    keep_bindings: ["secret_text", "secret_key"]
  };
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function formatCloudflareErrorMessage(input: {
  operation?: string;
  cloudflareMessage: string;
  requiredPermission?: string;
  authFailureHint?: string;
}): string {
  const prefix = input.operation ? `${input.operation} failed` : "Cloudflare API request failed";
  const parts = [`${prefix}: ${input.cloudflareMessage}`];
  if (input.requiredPermission) {
    parts.push(`Required Cloudflare permission: ${input.requiredPermission}.`);
  }
  if (input.authFailureHint && input.cloudflareMessage.toLowerCase().includes("authentication")) {
    parts.push(input.authFailureHint);
  }
  return parts.join(" ");
}

function cloudflareErrorContext(
  init: CloudflareRequestInit,
  cloudflareMessage: string
): {
  operation?: string;
  cloudflareMessage: string;
  requiredPermission?: string;
  authFailureHint?: string;
} {
  return {
    ...(init.operation ? { operation: init.operation } : {}),
    cloudflareMessage,
    ...(init.requiredPermission ? { requiredPermission: init.requiredPermission } : {}),
    ...(init.authFailureHint ? { authFailureHint: init.authFailureHint } : {})
  };
}
