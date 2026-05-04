import { authErrorResponse, requireAdminUser } from "@/lib/auth";
import { getPlatformRuntimeEnv } from "@/lib/platform-env";
import { resolveDeploymentRepository } from "@/lib/repositories";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireAdminUser(request);
    const env = getPlatformRuntimeEnv();
    const repository = resolveDeploymentRepository(env.DB ? { DB: env.DB } : {}, env);
    const deployments = await repository.repository.list(100);

    return Response.json({
      user,
      repository: repository.kind,
      deployments
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
