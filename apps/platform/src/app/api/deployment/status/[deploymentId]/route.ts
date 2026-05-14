import { authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { automationSnapshotForRequest } from "@/lib/environment";
import { getPlatformRuntimeEnv, readEnvString } from "@/lib/platform-env";
import { resolveDeploymentRepository } from "@/lib/repositories";

export async function GET(
  request: Request,
  context: { params: Promise<{ deploymentId: string }> }
): Promise<Response> {
  try {
    await requireAuthenticatedUser(request);
    const { deploymentId } = await context.params;
    const env = getPlatformRuntimeEnv();
    const repository = resolveDeploymentRepository(env.DB ? { DB: env.DB } : {}, env);
    const deployment = await repository.repository.get(deploymentId);
    const events = await repository.repository.listEvents(deploymentId);

    if (!deployment) {
      return Response.json(
        {
          error: "Deployment was not found in D1.",
          deploymentId
        },
        { status: 404 }
      );
    }

    return Response.json({
      deploymentId,
      status: deployment.status,
      agentUrl: deployment.agentUrl,
      events,
      resourcePlan: deployment.resourcePlan,
      automation: automationSnapshotForRequest(undefined, {
        repository: repository.kind,
        workersAIAvailable: Boolean(env.AI),
        env
      }),
      services: {
        worker: readEnvString(env, "CLOUDFLARE_ACCOUNT_ID") ? "configured" : "unconfigured",
        durableObjects: env.AGENT_DO && env.CHAT_DO && env.TERMINAL_DO ? "bound" : "unbound",
        container: "managed-by-TerminalDO",
        terminal: env.TERMINAL_DO ? "bound" : "unbound"
      }
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
