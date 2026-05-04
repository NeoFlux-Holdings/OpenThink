import type { AutoSyncConfig } from "@open-think/sync";
import { authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import {
  DeploymentUpdateError,
  runDeploymentUpdate,
  summarizeDeploymentUpdate,
  type DeploymentUpdateAction
} from "@/lib/deployment-update";
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
    const user = await requireAuthenticatedUser(request);
    const env = getPlatformRuntimeEnv();
    const repository = resolveDeploymentRepository(env.DB ? { DB: env.DB } : {}, env);
    const deployments = (await repository.repository.list(100))
      .filter((deployment) => deployment.userId === user.id)
      .map((deployment) => summarizeDeploymentUpdate(deployment, env));

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
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireAuthenticatedUser(request);
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
    const deployment = await repository.repository.get(payload.deploymentId.trim());

    if (!deployment) {
      return Response.json({ error: "Deployment was not found." }, { status: 404 });
    }

    if (deployment.userId !== user.id) {
      return Response.json({ error: "Deployment does not belong to the current user." }, { status: 403 });
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
