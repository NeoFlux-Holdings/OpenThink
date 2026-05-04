import type { SyncAction } from "@open-think/sync";
import { AuthError, authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getPlatformRuntimeEnv } from "@/lib/platform-env";
import { runSyncAction } from "@/lib/sync-service";

const actions = new Set<SyncAction>([
  "pull",
  "commit",
  "push",
  "deploy",
  "reconcile"
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await resolveSyncUser(request);
    const payload = (await request.json().catch(() => ({}))) as {
      action?: SyncAction;
      message?: string;
    };

    if (!payload.action || !actions.has(payload.action)) {
      return Response.json(
        {
          error: "Unsupported sync action."
        },
        { status: 400 }
      );
    }

    const options: { message?: string } = {};
    if (payload.message) options.message = payload.message;
    const result = await runSyncAction(payload.action, {
      ...options,
      env: getPlatformRuntimeEnv()
    });

    return Response.json({
      user,
      result
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Sync action failed."
      },
      { status: 500 }
    );
  }
}

async function resolveSyncUser(request: Request): Promise<{ id: string; source: string }> {
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
