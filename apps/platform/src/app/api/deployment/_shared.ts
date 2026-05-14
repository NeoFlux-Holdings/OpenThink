import { AuthError, authErrorResponse, requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { CloudflareApiError, CloudflareConfigurationError } from "@/lib/cloudflare-api";
import {
  buildDeploymentRequest,
  DeploymentEngine,
  DeploymentProvisioningError,
  DeploymentValidationError,
  type DeploymentFlow,
  type DeploymentRequest
} from "@/lib/deployment-engine";
import { EnvironmentValidationError } from "@/lib/environment";
import { isDeploymentQueueBinding } from "@/lib/deployment-queue";
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
    const engine = new DeploymentEngine({
      platformHost: readEnvString(env, "NEXT_PUBLIC_PLATFORM_HOST") ?? "beta2.open-think.app",
      env,
      workersAIAvailable: Boolean(env.AI),
      repository: repository.repository,
      repositoryKind: repository.kind
    });
    const canUseQueue =
      isDeploymentQueueBinding(env.DEPLOYMENT_QUEUE) && repository.kind !== "memory";
    const result = canUseQueue
      ? await engine.prepareQueued(deploymentRequest)
      : await engine.stream(deploymentRequest);

    if ("queueMessage" in result && isDeploymentQueueBinding(env.DEPLOYMENT_QUEUE)) {
      await env.DEPLOYMENT_QUEUE.send(result.queueMessage);
    }

    if ("completion" in result) {
      void result.completion.catch((error: unknown) => {
        console.error("[deployment] Streaming deployment failed", error);
      });
    }

    return new Response(result.sseStream, {
      status: 202,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Deployment-Id": result.deploymentId,
        "X-Agent-Url": result.plannedAgentUrl,
        "X-Automation-Mode": result.automation.deploymentMode,
        "X-Provisioner": result.automation.provisioner,
        "X-Repository": result.automation.repository,
        "X-AI-Provider": result.automation.aiProvider,
        "X-Auth-Source": user.source,
        "X-Continuation": canUseQueue ? "queue" : "request-stream"
      }
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    const rootError = error instanceof DeploymentProvisioningError ? error.cause : error;
    const message =
      error instanceof Error ? error.message : "Deployment request failed.";
    const status =
      error instanceof DeploymentValidationError ||
      rootError instanceof EnvironmentValidationError ||
      rootError instanceof CloudflareConfigurationError
        ? 400
        : rootError instanceof CloudflareApiError
          ? rootError.status === 401 || rootError.status === 403
            ? 400
            : 502
        : 500;

    return Response.json(
      {
      error: message,
      deploymentId:
        error instanceof DeploymentProvisioningError
          ? error.deploymentId
          : undefined,
      cloudflare:
        rootError instanceof CloudflareApiError
          ? {
              status: rootError.status,
              operation: rootError.operation,
              requiredPermission: rootError.requiredPermission
            }
          : undefined,
      missing:
        rootError instanceof EnvironmentValidationError ||
        rootError instanceof CloudflareConfigurationError
            ? rootError.missing
            : undefined,
        warnings:
          rootError instanceof EnvironmentValidationError ? rootError.warnings : undefined
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
