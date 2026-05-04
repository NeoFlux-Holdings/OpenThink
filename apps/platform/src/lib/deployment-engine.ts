import type {
  CloudflareProvisioningAdapter,
  CloudflareResourcePlan
} from "./cloudflare-api";
import { fingerprintToken } from "./security";
import {
  inspectCloudflareToken,
  provisioningAdapterFromEnv
} from "./cloudflare-api";
import type { DeploymentRepository } from "./d1";
import {
  assertAutomationEnvironment,
  automationSnapshotForRequest,
  type AutomationSnapshot,
  type RepositoryKind
} from "./environment";

export type { AutomationSnapshot } from "./environment";

export type DeploymentFlow = "self" | "stripe" | "button" | "agent" | "partner";
export type StarterTemplate = "personal-agent";
export type DeploymentStatus = "provisioning" | "deploying" | "ready" | "failed";
export type DeploymentEventStatus = "pending" | "active" | "complete" | "error";

export interface DeploymentRequest {
  flow: DeploymentFlow;
  starterTemplate: StarterTemplate;
  userId: string;
  agentName?: string;
  cloudflareAccountId?: string;
  accessAllowedEmail?: string;
  accessAdditionalEmails?: string[];
  defaultModel?: string;
  modelProvider?: "workers-ai" | "openrouter" | "anthropic" | "openai";
  thinkingLevel?: "low" | "medium" | "high" | "xhigh";
  providerKeys?: {
    openRouterApiKey?: string;
    anthropicApiKey?: string;
    openAiApiKey?: string;
  };
  customDomain?: {
    enabled?: boolean;
    hostname?: string;
    zoneId?: string;
  };
  stripeSessionId?: string;
  githubOAuthToken?: string;
  cfApiToken?: string;
  partnerAccountId?: string;
  spendLimitUsd?: number;
  acceptedTerms?: boolean;
}

export interface DeploymentEvent {
  id: string;
  stage: string;
  status: DeploymentEventStatus;
  progress: number;
  label: string;
  detail: string;
  timestamp: string;
  resources?: DeploymentResource[];
  automation?: AutomationSnapshot;
}

export interface DeploymentResource {
  type: "Worker" | "Access" | "D1" | "R2" | "Vectorize" | "Queue" | "Container";
  name: string;
  binding?: string;
}

export interface DeploymentResult {
  deploymentId: string;
  agentUrl: string;
  status: DeploymentStatus;
  events: DeploymentEvent[];
  resourcePlan: CloudflareResourcePlan;
  automation: AutomationSnapshot;
  sseStream: ReadableStream<Uint8Array>;
}

export interface DeploymentEngineOptions {
  platformHost: string;
  env?: Record<string, unknown>;
  workersAIAvailable?: boolean;
  eventDelayMs?: number;
  provisioner?: CloudflareProvisioningAdapter;
  repository?: DeploymentRepository;
  repositoryKind?: RepositoryKind;
}

const validFlows = new Set<DeploymentFlow>([
  "self",
  "stripe",
  "button",
  "agent",
  "partner"
]);

const validStarters = new Set<StarterTemplate>(["personal-agent"]);
const validModelProviders = new Set(["workers-ai", "openrouter", "anthropic", "openai"]);
const validThinkingLevels = new Set(["low", "medium", "high", "xhigh"]);
const defaultSpendLimitUsd = 100;

export class DeploymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentValidationError";
  }
}

export class DeploymentEngine {
  private readonly options: DeploymentEngineOptions & {
    eventDelayMs: number;
  };

  constructor(options: DeploymentEngineOptions) {
    this.options = {
      ...options,
      eventDelayMs: options.eventDelayMs ?? 450,
      platformHost: options.platformHost
    };
  }

  async deploy(request: DeploymentRequest): Promise<DeploymentResult> {
    const resolvedRequest = await this.resolveRequest(request);
    this.validate(resolvedRequest);

    const deploymentId = createDeploymentId(resolvedRequest);
    const plannedAgentUrl = `https://${deploymentId}.${this.options.platformHost}`;
    const automationOptions: { repository?: RepositoryKind } = {};
    if (this.options.repositoryKind) {
      automationOptions.repository = this.options.repositoryKind;
    }
    const snapshotOptions: {
      repository?: RepositoryKind;
      workersAIAvailable?: boolean;
      env?: Record<string, unknown>;
    } = { ...automationOptions };
    if (this.options.workersAIAvailable !== undefined) {
      snapshotOptions.workersAIAvailable = this.options.workersAIAvailable;
    }
    if (this.options.env) {
      snapshotOptions.env = this.options.env;
    }
    const automation = automationSnapshotForRequest(resolvedRequest, snapshotOptions);
    assertAutomationEnvironment(automation);

    const provisioner =
      this.options.provisioner ?? provisioningAdapterFromEnv(resolvedRequest, this.options.env);
    const resourcePlan = await provisioner.provision(resolvedRequest, deploymentId);
    const agentUrl = resourcePlan.workerDeployment?.url ?? plannedAgentUrl;
    const events = buildDeploymentEvents(
      resolvedRequest,
      deploymentId,
      agentUrl,
      resourcePlan,
      automation
    );
    const authorization = {
      accountId: resourcePlan.accountId,
      spendLimitUsd: resolvedRequest.spendLimitUsd ?? defaultSpendLimitUsd,
      termsAcceptedAt: new Date().toISOString(),
      tenantKind: resolvedRequest.flow === "partner" ? "partner" as const : "self" as const,
      agentName: resolvedRequest.agentName?.trim() || "Personal Agent"
    };
    const tokenFingerprint = await fingerprintOptionalToken(resolvedRequest.cfApiToken);

    await this.options.repository?.create({
      id: deploymentId,
      userId: resolvedRequest.userId,
      flow: resolvedRequest.flow,
      starterTemplate: resolvedRequest.starterTemplate,
      status: "deploying",
      agentUrl,
      resourcePlan: resourcePlan as unknown as Record<string, unknown>,
      authorization: tokenFingerprint ? { ...authorization, tokenFingerprint } : authorization
    });

    return {
      deploymentId,
      agentUrl,
      status: "deploying",
      events,
      resourcePlan,
      automation,
      sseStream: createSseStream(events, this.options.eventDelayMs, {
        onEvent: (event) =>
          this.options.repository?.appendEvent(deploymentId, event) ?? Promise.resolve(),
        onDone: () =>
          this.options.repository?.updateStatus(
            deploymentId,
            "ready",
            resourcePlan as unknown as Record<string, unknown>
          ) ?? Promise.resolve()
      })
    };
  }

  private async resolveRequest(request: DeploymentRequest): Promise<DeploymentRequest> {
    if (this.options.provisioner || !shouldInspectToken(request)) {
      return request;
    }

    const inspection = await inspectCloudflareToken({
      apiToken: request.cfApiToken?.trim() ?? ""
    });

    return {
      ...request,
      ...(request.cloudflareAccountId?.trim()
        ? {}
        : inspection.defaultAccountId
          ? { cloudflareAccountId: inspection.defaultAccountId }
          : {}),
      ...(request.accessAllowedEmail?.trim()
        ? {}
        : inspection.defaultAccessEmail
          ? { accessAllowedEmail: inspection.defaultAccessEmail }
          : {})
    };
  }

  private validate(request: DeploymentRequest): void {
    if (!validFlows.has(request.flow)) {
      throw new DeploymentValidationError("Unsupported deployment flow.");
    }

    if (!validStarters.has(request.starterTemplate)) {
      throw new DeploymentValidationError("Only the all-in-one personal agent template is supported.");
    }

    if (!request.userId.trim()) {
      throw new DeploymentValidationError("A user id is required.");
    }

    if ((request.flow === "self" || request.flow === "agent") && !request.cfApiToken?.trim()) {
      throw new DeploymentValidationError("Self deployment requires a scoped Cloudflare API token.");
    }

    if (
      (request.flow === "self" || request.flow === "agent") &&
      !request.cloudflareAccountId?.trim() &&
      !this.options.provisioner
    ) {
      throw new DeploymentValidationError(
        "Self deployment requires a Cloudflare account id when it cannot be inferred from the token."
      );
    }

    if ((request.flow === "self" || request.flow === "agent") && !request.acceptedTerms) {
      throw new DeploymentValidationError("You must accept the public deployment terms.");
    }

    if (request.modelProvider && !validModelProviders.has(request.modelProvider)) {
      throw new DeploymentValidationError("Unsupported model provider.");
    }

    if (request.thinkingLevel && !validThinkingLevels.has(request.thinkingLevel)) {
      throw new DeploymentValidationError("Unsupported thinking level.");
    }

    if (request.accessAllowedEmail && !isEmailLike(request.accessAllowedEmail)) {
      throw new DeploymentValidationError("A valid Cloudflare Access login email is required.");
    }

    for (const email of request.accessAdditionalEmails ?? []) {
      if (!isEmailLike(email)) {
        throw new DeploymentValidationError("Every additional Cloudflare Access email must be valid.");
      }
    }

    if (request.customDomain?.enabled) {
      if (!isHostnameLike(request.customDomain.hostname)) {
        throw new DeploymentValidationError("Custom domain must be a valid hostname, such as agent.example.com.");
      }
      if (!request.customDomain.zoneId?.trim()) {
        throw new DeploymentValidationError("Custom domain setup requires choosing a Cloudflare DNS zone.");
      }
    }

    const spendLimit = request.spendLimitUsd ?? defaultSpendLimitUsd;
    if (!Number.isFinite(spendLimit) || spendLimit < 5 || spendLimit > defaultSpendLimitUsd) {
      throw new DeploymentValidationError(`Spend limit must be between $5 and $${defaultSpendLimitUsd}.`);
    }

    if (request.flow === "stripe" && !request.stripeSessionId?.trim()) {
      throw new DeploymentValidationError("Stripe flow requires a session id.");
    }

    if (request.flow === "button" && !request.githubOAuthToken?.trim()) {
      throw new DeploymentValidationError("Deploy button flow requires a GitHub OAuth token.");
    }

    if (request.flow === "partner" && !request.partnerAccountId?.trim()) {
      throw new DeploymentValidationError("Partner flow requires a partner account id.");
    }
  }
}

export function buildDeploymentRequest(
  flow: DeploymentFlow,
  input: Partial<DeploymentRequest>
): DeploymentRequest {
  const request: DeploymentRequest = {
    flow,
    starterTemplate: "personal-agent",
    userId: input.userId?.trim() ?? ""
  };

  if (input.agentName) request.agentName = input.agentName;
  if (input.cloudflareAccountId) request.cloudflareAccountId = input.cloudflareAccountId;
  if (input.accessAllowedEmail) request.accessAllowedEmail = input.accessAllowedEmail;
  if (input.accessAdditionalEmails) request.accessAdditionalEmails = input.accessAdditionalEmails;
  if (input.defaultModel) request.defaultModel = input.defaultModel;
  if (input.modelProvider) request.modelProvider = input.modelProvider;
  if (input.thinkingLevel) request.thinkingLevel = input.thinkingLevel;
  if (input.providerKeys) request.providerKeys = input.providerKeys;
  if (input.customDomain) request.customDomain = input.customDomain;
  if (input.stripeSessionId) request.stripeSessionId = input.stripeSessionId;
  if (input.githubOAuthToken) request.githubOAuthToken = input.githubOAuthToken;
  if (input.cfApiToken) request.cfApiToken = input.cfApiToken;
  if (input.partnerAccountId) request.partnerAccountId = input.partnerAccountId;
  if (input.spendLimitUsd !== undefined) request.spendLimitUsd = input.spendLimitUsd;
  if (input.acceptedTerms !== undefined) request.acceptedTerms = input.acceptedTerms;

  return request;
}

export function deploymentEngineFromEnv(): DeploymentEngine {
  return new DeploymentEngine({
    platformHost: process.env.NEXT_PUBLIC_PLATFORM_HOST ?? "beta2.open-think.app",
    env: process.env
  });
}

function createDeploymentId(request: DeploymentRequest): string {
  const seed = `${request.userId}-${request.flow}-${request.starterTemplate}-${Date.now()}`;
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return `agent-${Math.abs(hash).toString(36).slice(0, 8)}`;
}

function buildDeploymentEvents(
  request: DeploymentRequest,
  deploymentId: string,
  agentUrl: string,
  resourcePlan: CloudflareResourcePlan,
  automation: AutomationSnapshot
): DeploymentEvent[] {
  const now = new Date();
  const flowLabel = flowToLabel(request.flow);

  return [
    {
      id: "validate",
      stage: "Request",
      status: "complete",
      progress: 12,
      label: `${flowLabel} request accepted`,
      detail: `${request.agentName?.trim() || "Personal Agent"} mapped to deployment ${deploymentId}.`,
      timestamp: now.toISOString(),
      automation
    },
    {
      id: "account",
      stage: "Account",
      status: "complete",
      progress: 28,
      label: accountStepLabel(request.flow),
      detail: `Using the user's Cloudflare account with a $${request.spendLimitUsd ?? defaultSpendLimitUsd} self-service spend guardrail.`,
      timestamp: new Date(now.getTime() + 1000).toISOString()
    },
    {
      id: "bindings",
      stage: "Bindings",
      status: "complete",
      progress: 46,
      label: "Cloudflare resources created",
      detail: `Created or reused D1 ${resourcePlan.d1Database.name}, R2 ${resourcePlan.r2Bucket.name}, Vectorize ${resourcePlan.vectorizeIndex.name}, Queue ${resourcePlan.queue.name}, AI, and the personal agent Worker.`,
      timestamp: new Date(now.getTime() + 2000).toISOString(),
      resources: resourceList(resourcePlan)
    },
    {
      id: "deploy",
      stage: "Deploy",
      status: "complete",
      progress: 74,
      label: "Worker module uploaded",
      detail: resourcePlan.workerDeployment
        ? `Uploaded ${resourcePlan.workerDeployment.scriptName}, enabled workers.dev, and attached Cloudflare Access.`
        : `Worker upload for ${resourcePlan.scriptName} completed by the configured provisioner.`,
      timestamp: new Date(now.getTime() + 3000).toISOString()
    },
    {
      id: "ready",
      stage: "Ready",
      status: "complete",
      progress: 100,
      label: "Agent control plane online",
      detail: `Agent URL: ${agentUrl}`,
      timestamp: new Date(now.getTime() + 4000).toISOString()
    }
  ];
}

function resourceList(resourcePlan: CloudflareResourcePlan): DeploymentResource[] {
  return [
    {
      type: "Worker",
      name: resourcePlan.scriptName
    },
    ...(resourcePlan.workerDeployment?.accessApplicationId
      ? [
          {
            type: "Access" as const,
            name: resourcePlan.workerDeployment.accessApplicationId,
            binding: "Cloudflare Access"
          }
        ]
      : []),
    {
      type: "D1",
      name: resourcePlan.d1Database.name,
      binding: "DB"
    },
    {
      type: "R2",
      name: resourcePlan.r2Bucket.name,
      binding: "AGENT_STORAGE"
    },
    {
      type: "Vectorize",
      name: resourcePlan.vectorizeIndex.name,
      binding: "VECTORIZE"
    },
    {
      type: "Queue",
      name: resourcePlan.queue.name,
      binding: "TASK_QUEUE"
    },
    {
      type: "Container",
      name: "AgentContainer"
    }
  ];
}

function createSseStream(
  events: DeploymentEvent[],
  delayMs: number,
  lifecycle: {
    onEvent?: (event: DeploymentEvent) => Promise<void>;
    onDone?: () => Promise<void>;
  } = {}
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let index = 0;

      const push = () => {
        void pushEvent();
      };

      const pushEvent = async () => {
        if (cancelled) return;

        const event = events[index];

        if (!event) {
          await lifecycle.onDone?.();
          if (cancelled) return;
          controller.enqueue(
            encoder.encode(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`)
          );
          controller.close();
          return;
        }

        await lifecycle.onEvent?.(event);
        if (cancelled) return;
        controller.enqueue(
          encoder.encode(`event: deployment\ndata: ${JSON.stringify(event)}\n\n`)
        );
        index += 1;
        timer = setTimeout(push, delayMs);
      };

      push();
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    }
  });
}

function flowToLabel(flow: DeploymentFlow): string {
  switch (flow) {
    case "self":
      return "Self-service Cloudflare";
    case "stripe":
      return "Stripe Projects";
    case "button":
      return "Deploy Button";
    case "agent":
      return "Agentic MCP";
    case "partner":
      return "Partner API";
  }
}

function accountStepLabel(flow: DeploymentFlow): string {
  switch (flow) {
    case "self":
      return "User-owned Cloudflare account selected";
    case "stripe":
      return "Cloudflare account and $100 spend limit staged";
    case "button":
      return "GitHub repository and Actions secrets staged";
    case "agent":
      return "Scoped API token and MCP execution plan staged";
    case "partner":
      return "Partner tenant and account ownership staged";
  }
}

async function fingerprintOptionalToken(token: string | undefined): Promise<string | undefined> {
  if (!token) return undefined;
  return fingerprintToken(token);
}

function isEmailLike(value: string | undefined): boolean {
  return Boolean(value?.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
}

function isHostnameLike(value: string | undefined): boolean {
  const hostname = value?.trim().toLowerCase();
  return Boolean(
    hostname &&
      hostname.length <= 253 &&
      hostname.includes(".") &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname)
  );
}

function shouldInspectToken(request: DeploymentRequest): boolean {
  const userOwnedFlow =
    request.flow === "self" || request.flow === "agent" || request.flow === "button";
  return userOwnedFlow && Boolean(request.cfApiToken?.trim()) && (
    !request.cloudflareAccountId?.trim() || !request.accessAllowedEmail?.trim()
  );
}
