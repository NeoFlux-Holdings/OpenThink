import { AuthError, authErrorResponse, requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { CloudflareApiError, CloudflareConfigurationError } from "@/lib/cloudflare-api";
import {
  buildDeploymentRequest,
  DeploymentEngine,
  DeploymentValidationError,
  type DeploymentFlow,
  type DeploymentRequest
} from "@/lib/deployment-engine";
import { EnvironmentValidationError } from "@/lib/environment";
import { getPlatformRuntimeEnv, readEnvString } from "@/lib/platform-env";
import { resolveDeploymentRepository } from "@/lib/repositories";

export async function handleDeploymentRequest(
  request: Request,
  flow: DeploymentFlow
): Promise<Response> {
  try {
    const user = await resolveDeploymentUser(request, flow);
    const payload = (await request.json()) as Partial<DeploymentRequest>;
    const deploymentRequest = buildDeploymentRequest(flow, {
      ...payload,
      userId: user.id
    });
    const env = getPlatformRuntimeEnv();
    const repository = resolveDeploymentRepository(env.DB ? { DB: env.DB } : {}, env);
    const result = await new DeploymentEngine({
      platformHost: readEnvString(env, "NEXT_PUBLIC_PLATFORM_HOST") ?? "beta2.open-think.app",
      env,
      workersAIAvailable: Boolean(env.AI),
      repository: repository.repository,
      repositoryKind: repository.kind
    }).deploy(deploymentRequest);

    return new Response(result.sseStream, {
      status: 202,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Deployment-Id": result.deploymentId,
        "X-Agent-Url": result.agentUrl,
        "X-Automation-Mode": result.automation.deploymentMode,
        "X-Provisioner": result.automation.provisioner,
        "X-Repository": result.automation.repository,
        "X-AI-Provider": result.automation.aiProvider,
        "X-Auth-Source": user.source
      }
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    const message =
      error instanceof Error ? error.message : "Deployment request failed.";
    const status =
      error instanceof DeploymentValidationError ||
      error instanceof EnvironmentValidationError ||
      error instanceof CloudflareConfigurationError
        ? 400
        : error instanceof CloudflareApiError
          ? error.status === 401 || error.status === 403
            ? 400
            : 502
        : 500;

    return Response.json(
      {
      error: message,
      cloudflare:
        error instanceof CloudflareApiError
          ? {
              status: error.status,
              operation: error.operation,
              requiredPermission: error.requiredPermission
            }
          : undefined,
      missing:
        error instanceof EnvironmentValidationError ||
        error instanceof CloudflareConfigurationError
            ? error.missing
            : undefined,
        warnings:
          error instanceof EnvironmentValidationError ? error.warnings : undefined
      },
      { status }
    );
  }
}

async function resolveDeploymentUser(
  request: Request,
  flow: DeploymentFlow
): Promise<AuthenticatedUser> {
  try {
    return await requireAuthenticatedUser(request);
  } catch (error) {
    if (!(error instanceof AuthError) || flow !== "self") {
      throw error;
    }

    return {
      id: "self-service-user",
      source: "dev"
    };
  }
}
