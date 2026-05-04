import { authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getPlatformRuntimeEnv } from "@/lib/platform-env";
import { syncServiceFromEnv } from "@/lib/sync-service";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireAuthenticatedUser(request);
    const status = await syncServiceFromEnv(getPlatformRuntimeEnv()).status();

    return Response.json({
      user,
      status
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
