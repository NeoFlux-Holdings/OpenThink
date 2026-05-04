import type { AutoSyncConfig } from "@open-think/sync";
import { authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getPlatformRuntimeEnv } from "@/lib/platform-env";
import { setAutoSyncFromEnv } from "@/lib/sync-service";

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireAuthenticatedUser(request);
    const payload = (await request.json().catch(() => ({}))) as Partial<AutoSyncConfig>;
    const config: Partial<AutoSyncConfig> = {};
    if (payload.enabled !== undefined) config.enabled = payload.enabled;
    if (payload.direction) config.direction = payload.direction;
    if (payload.intervalSeconds !== undefined) {
      config.intervalSeconds = payload.intervalSeconds;
    }
    const status = await setAutoSyncFromEnv(config, getPlatformRuntimeEnv());

    return Response.json({
      user,
      status
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Auto sync update failed."
      },
      { status: 500 }
    );
  }
}
