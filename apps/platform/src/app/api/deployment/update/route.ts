import type { AutoSyncConfig } from "@open-think/sync";
import {
  AuthError,
  authErrorResponse,
  requireAuthenticatedUser,
  type AuthenticatedUser
} from "@/lib/auth";
import { discoverOpenThinkDeploymentsFromCloudflare } from "@/lib/deployment-discovery";
import {
  DeploymentUpdateError,
  runDeploymentUpdate,
  summarizeDeploymentUpdate,
  type DeploymentUpdateAction
} from "@/lib/deployment-update";
import type { DeploymentRecord, DeploymentRepository } from "@/lib/d1";
import { getPlatformRuntimeEnv } from "@/lib/platform-env";
import { resolveDeploymentRepository } from "@/lib/repositories";

const updateActions = new Set<DeploymentUpdateAction>([
  "status",
  "pull",
  "deploy",
  "reconcile"
]);

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await resolveUpdateUser(request);
    const env = getPlatformRuntimeEnv();
    const repository = resolveDeploymentRepository(env.DB ? { DB: env.DB } : {}, env);
    const existingDeployments = (await repository.repository.list(100)).filter((deployment) =>
      deploymentBelongsToUpdateUser(deployment.userId, user)
    );
    const cfApiToken = readCloudflareTokenHeader(request);
    const discoveredDeployments = cfApiToken
      ? await reattachCloudflareDeployments({
          apiToken: cfApiToken,
          user,
          repository: repository.repository,
          existingDeployments
        })
      : [];
    const deployments = mergeDeploymentRecords(existingDeployments, discoveredDeployments).map(
      (deployment) => summarizeDeploymentUpdate(deployment, env)
    );

    return Response.json({
      user,
      repository: repository.kind,
      deployments
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Deployment update status failed."
      },
      { status: error instanceof DeploymentUpdateError ? error.status : 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await resolveUpdateUser(request);
    const payload = (await request.json().catch(() => ({}))) as {
      deploymentId?: string;
      action?: DeploymentUpdateAction;
      cfApiToken?: string;
      autoUpdate?: Partial<AutoSyncConfig>;
    };
    const action = payload.action ?? "status";

    if (!payload.deploymentId?.trim()) {
      return Response.json({ error: "deploymentId is required." }, { status: 400 });
    }

    if (!updateActions.has(action)) {
      return Response.json({ error: "Unsupported deployment update action." }, { status: 400 });
    }

    const env = getPlatformRuntimeEnv();
    const repository = resolveDeploymentRepository(env.DB ? { DB: env.DB } : {}, env);
    let deployment = await repository.repository.get(payload.deploymentId.trim());

    if (!deployment && payload.cfApiToken?.trim()) {
      const discovered = await reattachCloudflareDeployments({
        apiToken: payload.cfApiToken,
        user,
        repository: repository.repository,
        existingDeployments: []
      });
      deployment =
        discovered.find((record) => record.id === payload.deploymentId?.trim()) ?? null;
    }

    if (!deployment) {
      return Response.json(
        {
          error:
            "Deployment was not found locally or in the Cloudflare account visible to this token."
        },
        { status: 404 }
      );
    }

    if (!deploymentBelongsToUpdateUser(deployment.userId, user)) {
      return Response.json(
        { error: "Deployment does not belong to the current user." },
        { status: 403 }
      );
    }

    const updateInput: Parameters<typeof runDeploymentUpdate>[0] = {
      deployment,
      action,
      env
    };
    if (payload.cfApiToken) updateInput.cfApiToken = payload.cfApiToken;
    if (payload.autoUpdate) updateInput.autoUpdate = payload.autoUpdate;
    const result = await runDeploymentUpdate(updateInput);

    await repository.repository.updateStatus(
      deployment.id,
      deployment.status,
      result.resourcePlan
    );

    return Response.json({
      user,
      repository: repository.kind,
      deployment: result.summary,
      status: result.status,
      result: result.result
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Deployment update failed."
      },
      { status: error instanceof DeploymentUpdateError ? error.status : 500 }
    );
  }
}

async function resolveUpdateUser(request: Request): Promise<AuthenticatedUser> {
  try {
    return await requireAuthenticatedUser(request);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    return {
      id: "self-service-user",
      source: "dev"
    };
  }
}

function deploymentBelongsToUpdateUser(deploymentUserId: string, user: AuthenticatedUser): boolean {
  if (deploymentUserId === user.id) return true;
  if (user.source !== "dev") return false;
  return deploymentUserId === "self-service-user" || deploymentUserId === "local-dev-user";
}

async function reattachCloudflareDeployments(input: {
  apiToken: string;
  user: AuthenticatedUser;
  repository: DeploymentRepository;
  existingDeployments: DeploymentRecord[];
}): Promise<DeploymentRecord[]> {
  const discovery = await discoverOpenThinkDeploymentsFromCloudflare({
    apiToken: input.apiToken,
    userId: input.user.id
  });
  if (!discovery.records.length && discovery.warnings.length) {
    throw new DeploymentUpdateError(
      `Cloudflare deployment discovery failed: ${discovery.warnings.join("; ")}`,
      400
    );
  }
  const existingIds = new Set(input.existingDeployments.map((deployment) => deployment.id));
  const reattached: DeploymentRecord[] = [];

  for (const record of discovery.records) {
    if (!deploymentBelongsToUpdateUser(record.userId, input.user)) continue;
    reattached.push(record);
    if (existingIds.has(record.id)) continue;
    const recoveredInput: Parameters<DeploymentRepository["create"]>[0] = {
      id: record.id,
      userId: record.userId,
      flow: record.flow,
      starterTemplate: record.starterTemplate,
      status: record.status,
      agentUrl: record.agentUrl,
      resourcePlan: record.resourcePlan
    };
    if (record.authorization) recoveredInput.authorization = record.authorization;
    await input.repository.create(recoveredInput);
  }

  return reattached;
}

function mergeDeploymentRecords(
  existingDeployments: DeploymentRecord[],
  discoveredDeployments: DeploymentRecord[]
): DeploymentRecord[] {
  const byId = new Map<string, DeploymentRecord>();
  for (const deployment of discoveredDeployments) byId.set(deployment.id, deployment);
  for (const deployment of existingDeployments) byId.set(deployment.id, deployment);
  return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function readCloudflareTokenHeader(request: Request): string | undefined {
  const token = request.headers.get("x-open-think-cf-api-token")?.trim();
  return token || undefined;
}
