import { AuthError, authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getPlatformRuntimeEnv } from "@/lib/platform-env";
import { syncServiceFromEnv } from "@/lib/sync-service";

export async function GET(request: Request): Promise<Response> {
  try {
    let user = null;
    try {
      user = await requireAuthenticatedUser(request);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
    }
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
