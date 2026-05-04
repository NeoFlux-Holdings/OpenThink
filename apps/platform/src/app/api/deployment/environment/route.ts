import { AuthError, authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { automationSnapshotForRequest } from "@/lib/environment";
import { getPlatformRuntimeEnv } from "@/lib/platform-env";
import { resolveDeploymentRepository } from "@/lib/repositories";

export async function GET(request: Request): Promise<Response> {
  try {
    let user = null;
    try {
      user = await requireAuthenticatedUser(request);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
    }

    const env = getPlatformRuntimeEnv();
    const repository = resolveDeploymentRepository(env.DB ? { DB: env.DB } : {}, env);

    return Response.json({
      user,
      automation: automationSnapshotForRequest(undefined, {
        repository: repository.kind,
        workersAIAvailable: Boolean(env.AI),
        env
      })
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
