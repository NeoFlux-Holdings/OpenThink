import type {
  DeploymentEvent,
  DeploymentFlow,
  DeploymentStatus,
  StarterTemplate
} from "./deployment-engine";

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface D1HttpDatabaseOptions {
  accountId: string;
  apiToken: string;
  databaseId: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

interface D1HttpEnvelope<T> {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: Array<{
    success?: boolean;
    error?: string;
    results?: T[];
    meta?: unknown;
  }>;
}

export class D1HttpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "D1HttpApiError";
  }
}

export class D1HttpDatabase implements D1DatabaseLike {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: D1HttpDatabaseOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.cloudflare.com/client/v4";
    this.fetcher = options.fetcher ?? fetch;
  }

  prepare(sql: string): D1PreparedStatementLike {
    return new D1HttpPreparedStatement(this.options, this.baseUrl, this.fetcher, sql);
  }
}

class D1HttpPreparedStatement implements D1PreparedStatementLike {
  private values: unknown[] = [];

  constructor(
    private readonly options: D1HttpDatabaseOptions,
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch,
    private readonly sql: string
  ) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async run(): Promise<unknown> {
    return this.query<unknown>();
  }

  async first<T = unknown>(): Promise<T | null> {
    const result = await this.query<T>();
    return result.results?.[0] ?? null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const result = await this.query<T>();
    return { results: result.results ?? [] };
  }

  private async query<T>(): Promise<{
    results?: T[];
    meta?: unknown;
  }> {
    const response = await this.fetcher(
      `${this.baseUrl}/accounts/${this.options.accountId}/d1/database/${this.options.databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sql: this.sql,
          params: this.values
        })
      }
    );
    const body = (await response.json().catch(() => null)) as
      | D1HttpEnvelope<T>
      | null;
    const queryResult = body?.result?.[0];

    if (!response.ok || body?.success === false || queryResult?.success === false) {
      throw new D1HttpApiError(
        queryResult?.error ??
          body?.errors?.[0]?.message ??
          `Cloudflare D1 query failed with ${response.status}`,
        response.status,
        body
      );
    }

    return queryResult ?? {};
  }
}

export interface DeploymentRecord {
  id: string;
  userId: string;
  flow: DeploymentFlow;
  starterTemplate: StarterTemplate;
  status: DeploymentStatus;
  agentUrl: string;
  resourcePlan: Record<string, unknown>;
  authorization?: DeploymentAuthorization;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentAuthorization {
  accountId: string;
  tokenFingerprint?: string;
  spendLimitUsd: number;
  termsAcceptedAt: string;
  tenantKind: "self" | "partner";
  agentName: string;
}

export interface DeploymentRecordInput {
  id: string;
  userId: string;
  flow: DeploymentFlow;
  starterTemplate: StarterTemplate;
  status: DeploymentStatus;
  agentUrl: string;
  resourcePlan?: Record<string, unknown>;
  authorization?: DeploymentAuthorization;
}

export interface DeploymentRepository {
  create(input: DeploymentRecordInput): Promise<DeploymentRecord>;
  updateStatus(
    deploymentId: string,
    status: DeploymentStatus,
    resourcePlan?: Record<string, unknown>,
    agentUrl?: string
  ): Promise<void>;
  appendEvent(deploymentId: string, event: DeploymentEvent): Promise<void>;
  listEvents(deploymentId: string): Promise<DeploymentEvent[]>;
  get(deploymentId: string): Promise<DeploymentRecord | null>;
  list(limit?: number): Promise<DeploymentRecord[]>;
}

export class D1DeploymentRepository implements DeploymentRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(input: DeploymentRecordInput): Promise<DeploymentRecord> {
    const now = new Date().toISOString();
    const resourcePlan = input.resourcePlan ?? {};

    await this.db
      .prepare(
        `insert into users (id, auth_source, created_at, updated_at)
        values (?, ?, ?, ?)
        on conflict(id) do update set updated_at = excluded.updated_at`
      )
      .bind(input.userId, "cloudflare-access-or-jwt", now, now)
      .run();

    await this.db
      .prepare(
        `insert into deployments (
          id, user_id, flow, starter_template, status, agent_url,
          resource_plan_json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          status = excluded.status,
          resource_plan_json = excluded.resource_plan_json,
          updated_at = excluded.updated_at`
      )
      .bind(
        input.id,
        input.userId,
        input.flow,
        input.starterTemplate,
        input.status,
        input.agentUrl,
        JSON.stringify(resourcePlan),
        now,
        now
      )
      .run();

    if (input.authorization) {
      await this.db
        .prepare(
          `insert into deployment_authorizations (
            deployment_id, user_id, cloudflare_account_id, token_fingerprint,
            spend_limit_usd, terms_accepted_at, tenant_kind, agent_name,
            created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(deployment_id) do update set
            cloudflare_account_id = excluded.cloudflare_account_id,
            token_fingerprint = excluded.token_fingerprint,
            spend_limit_usd = excluded.spend_limit_usd,
            terms_accepted_at = excluded.terms_accepted_at,
            tenant_kind = excluded.tenant_kind,
            agent_name = excluded.agent_name,
            updated_at = excluded.updated_at`
        )
        .bind(
          input.id,
          input.userId,
          input.authorization.accountId,
          input.authorization.tokenFingerprint ?? null,
          input.authorization.spendLimitUsd,
          input.authorization.termsAcceptedAt,
          input.authorization.tenantKind,
          input.authorization.agentName,
          now,
          now
        )
        .run();
    }

    return {
      ...input,
      resourcePlan,
      createdAt: now,
      updatedAt: now
    };
  }

  async updateStatus(
    deploymentId: string,
    status: DeploymentStatus,
    resourcePlan: Record<string, unknown> = {},
    agentUrl?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    if (agentUrl) {
      await this.db
        .prepare(
          `update deployments
          set status = ?, agent_url = ?, resource_plan_json = ?, updated_at = ?
          where id = ?`
        )
        .bind(status, agentUrl, JSON.stringify(resourcePlan), now, deploymentId)
        .run();
      return;
    }

    await this.db
      .prepare(
        `update deployments
        set status = ?, resource_plan_json = ?, updated_at = ?
        where id = ?`
      )
      .bind(status, JSON.stringify(resourcePlan), now, deploymentId)
      .run();
  }

  async appendEvent(deploymentId: string, event: DeploymentEvent): Promise<void> {
    await this.db
      .prepare(
        `insert into deployment_events (
          id, deployment_id, stage, status, progress, label, detail, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          stage = excluded.stage,
          status = excluded.status,
          progress = excluded.progress,
          label = excluded.label,
          detail = excluded.detail,
          created_at = excluded.created_at`
      )
      .bind(
        `${deploymentId}:${event.id}`,
        deploymentId,
        event.stage,
        event.status,
        event.progress,
        event.label,
        event.detail,
        event.timestamp
      )
      .run();
  }

  async listEvents(deploymentId: string): Promise<DeploymentEvent[]> {
    const rows = await this.db
      .prepare(
        `select id, stage, status, progress, label, detail, created_at as timestamp
        from deployment_events
        where deployment_id = ?
        order by created_at asc`
      )
      .bind(deploymentId)
      .all<DeploymentEventRow>();

    return rows.results.map((row) => ({
      id: row.id.includes(":") ? row.id.split(":").slice(1).join(":") : row.id,
      stage: row.stage,
      status: row.status,
      progress: row.progress,
      label: row.label,
      detail: row.detail,
      timestamp: row.timestamp
    }));
  }

  async get(deploymentId: string): Promise<DeploymentRecord | null> {
    const row = await this.db
      .prepare(
        `select
          deployments.id,
          deployments.user_id as userId,
          deployments.flow,
          deployments.starter_template as starterTemplate,
          deployments.status,
          deployments.agent_url as agentUrl,
          deployments.resource_plan_json as resourcePlanJson,
          deployments.created_at as createdAt,
          deployments.updated_at as updatedAt,
          deployment_authorizations.cloudflare_account_id as cloudflareAccountId,
          deployment_authorizations.token_fingerprint as tokenFingerprint,
          deployment_authorizations.spend_limit_usd as spendLimitUsd,
          deployment_authorizations.terms_accepted_at as termsAcceptedAt,
          deployment_authorizations.tenant_kind as tenantKind,
          deployment_authorizations.agent_name as agentName
        from deployments
        left join deployment_authorizations
          on deployment_authorizations.deployment_id = deployments.id
        where deployments.id = ?`
      )
      .bind(deploymentId)
      .first<DeploymentRecordRow>();

    if (!row) return null;
    const authorization = rowToAuthorization(row);

    return {
      id: row.id,
      userId: row.userId,
      flow: row.flow,
      starterTemplate: row.starterTemplate,
      status: row.status,
      agentUrl: row.agentUrl,
      resourcePlan: parseResourcePlan(row.resourcePlanJson),
      ...(authorization ? { authorization } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  async list(limit = 50): Promise<DeploymentRecord[]> {
    const rows = await this.db
      .prepare(
        `select
          deployments.id,
          deployments.user_id as userId,
          deployments.flow,
          deployments.starter_template as starterTemplate,
          deployments.status,
          deployments.agent_url as agentUrl,
          deployments.resource_plan_json as resourcePlanJson,
          deployments.created_at as createdAt,
          deployments.updated_at as updatedAt,
          deployment_authorizations.cloudflare_account_id as cloudflareAccountId,
          deployment_authorizations.token_fingerprint as tokenFingerprint,
          deployment_authorizations.spend_limit_usd as spendLimitUsd,
          deployment_authorizations.terms_accepted_at as termsAcceptedAt,
          deployment_authorizations.tenant_kind as tenantKind,
          deployment_authorizations.agent_name as agentName
        from deployments
        left join deployment_authorizations
          on deployment_authorizations.deployment_id = deployments.id
        order by deployments.created_at desc
        limit ?`
      )
      .bind(limit)
      .all<DeploymentRecordRow>();

    return rows.results.map((row) => {
      const authorization = rowToAuthorization(row);

      return {
        id: row.id,
        userId: row.userId,
        flow: row.flow,
        starterTemplate: row.starterTemplate,
        status: row.status,
        agentUrl: row.agentUrl,
        resourcePlan: parseResourcePlan(row.resourcePlanJson),
        ...(authorization ? { authorization } : {}),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };
    });
  }
}

export class InMemoryDeploymentRepository implements DeploymentRepository {
  private readonly records = new Map<string, DeploymentRecord>();
  private readonly events = new Map<string, DeploymentEvent[]>();

  async create(input: DeploymentRecordInput): Promise<DeploymentRecord> {
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      ...input,
      resourcePlan: input.resourcePlan ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.records.set(input.id, record);
    return record;
  }

  async updateStatus(
    deploymentId: string,
    status: DeploymentStatus,
    resourcePlan: Record<string, unknown> = {},
    agentUrl?: string
  ): Promise<void> {
    const existing = this.records.get(deploymentId);
    if (!existing) return;
    this.records.set(deploymentId, {
      ...existing,
      status,
      agentUrl: agentUrl ?? existing.agentUrl,
      resourcePlan,
      updatedAt: new Date().toISOString()
    });
  }

  async appendEvent(deploymentId: string, event: DeploymentEvent): Promise<void> {
    const events = this.events.get(deploymentId) ?? [];
    const existingIndex = events.findIndex((item) => item.id === event.id);
    if (existingIndex >= 0) {
      events[existingIndex] = event;
    } else {
      events.push(event);
    }
    this.events.set(deploymentId, events);
  }

  async listEvents(deploymentId: string): Promise<DeploymentEvent[]> {
    return [...(this.events.get(deploymentId) ?? [])];
  }

  async get(deploymentId: string): Promise<DeploymentRecord | null> {
    return this.records.get(deploymentId) ?? null;
  }

  async list(limit = 50): Promise<DeploymentRecord[]> {
    return [...this.records.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }
}

interface DeploymentRecordRow {
  id: string;
  userId: string;
  flow: DeploymentFlow;
  starterTemplate: StarterTemplate;
  status: DeploymentStatus;
  agentUrl: string;
  resourcePlanJson: string;
  createdAt: string;
  updatedAt: string;
  cloudflareAccountId?: string | null;
  tokenFingerprint?: string | null;
  spendLimitUsd?: number | null;
  termsAcceptedAt?: string | null;
  tenantKind?: "self" | "partner" | null;
  agentName?: string | null;
}

interface DeploymentEventRow {
  id: string;
  stage: string;
  status: DeploymentEvent["status"];
  progress: number;
  label: string;
  detail: string;
  timestamp: string;
}

function parseResourcePlan(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rowToAuthorization(row: DeploymentRecordRow): DeploymentAuthorization | undefined {
  if (!row.cloudflareAccountId || !row.spendLimitUsd || !row.termsAcceptedAt || !row.tenantKind || !row.agentName) {
    return undefined;
  }

  return {
    accountId: row.cloudflareAccountId,
    ...(row.tokenFingerprint ? { tokenFingerprint: row.tokenFingerprint } : {}),
    spendLimitUsd: row.spendLimitUsd,
    termsAcceptedAt: row.termsAcceptedAt,
    tenantKind: row.tenantKind,
    agentName: row.agentName
  };
}
