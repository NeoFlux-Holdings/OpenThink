import {
  CloudflareApiClient,
  CloudflareApiError,
  inspectCloudflareToken
} from "@/lib/cloudflare-api";

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json().catch(() => ({}))) as {
      cfApiToken?: string;
      cloudflareAccountId?: string;
      customDomainZoneId?: string;
    };
    const token = payload.cfApiToken?.trim();
    if (!token) {
      return Response.json({ error: "Cloudflare API token is required." }, { status: 400 });
    }

    const inspection = await inspectCloudflareToken({ apiToken: token });
    const accountId = payload.cloudflareAccountId?.trim() || inspection.defaultAccountId;
    let permissionIssue:
      | {
          error: string;
          cloudflare?: {
            status: number;
            operation?: string;
            requiredPermission?: string;
          };
        }
      | undefined;

    if (accountId) {
      try {
        const client = new CloudflareApiClient({
          accountId,
          apiToken: token
        });
        await client.verifyAccountAccess();
        await client.verifyProvisioningPermissions();
        if (payload.customDomainZoneId?.trim()) {
          await client.verifyCustomDomainPermissions(payload.customDomainZoneId.trim());
        }
      } catch (error) {
        const cloudflare =
          error instanceof CloudflareApiError
            ? {
                status: error.status,
                ...(error.operation ? { operation: error.operation } : {}),
                ...(error.requiredPermission
                  ? { requiredPermission: error.requiredPermission }
                  : {})
              }
            : undefined;
        permissionIssue = {
          error: error instanceof Error ? error.message : "Cloudflare permission check failed.",
          ...(cloudflare ? { cloudflare } : {})
        };
      }
    }

    return Response.json(
      { inspection, permissionIssue },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Token verification failed.",
        cloudflare:
          error instanceof CloudflareApiError
            ? {
                status: error.status,
                operation: error.operation,
                requiredPermission: error.requiredPermission
              }
            : undefined
      },
      { status: error instanceof CloudflareApiError ? 400 : 500 }
    );
  }
}
