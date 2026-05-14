import {
  CloudflareApiClient,
  CloudflareApiError,
  inspectCloudflareToken
} from "@/lib/cloudflare-api";

interface DomainStatusPayload {
  cfApiToken?: string;
  cloudflareAccountId?: string;
  domain?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json().catch(() => ({}))) as DomainStatusPayload;
    const token = payload.cfApiToken?.trim();
    if (!token) {
      return Response.json({ error: "Cloudflare API token is required." }, { status: 400 });
    }

    const domain = normalizeDomainName(payload.domain);
    if (!domain) {
      return Response.json(
        { error: "Choose an exact domain name before checking registration status." },
        { status: 400 }
      );
    }

    const inspection = await inspectCloudflareToken({ apiToken: token });
    const accountId = payload.cloudflareAccountId?.trim() || inspection.defaultAccountId;
    if (!accountId) {
      return Response.json(
        { error: "Choose a Cloudflare account before checking registration status." },
        { status: 400 }
      );
    }

    const client = new CloudflareApiClient({
      accountId,
      apiToken: token
    });
    await client.verifyAccountAccess();
    const status = await client.getRegistrarRegistrationStatus(domain);

    return Response.json(
      {
        accountId,
        domain,
        status,
        terminal: isTerminalRegistrationState(status),
        summary: summarizeRegistrationState(status)
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Domain registration status check failed.",
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

function normalizeDomainName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    return null;
  }
  return domain;
}

function isTerminalRegistrationState(status: Record<string, unknown>): boolean {
  const value = String(
    status.state ?? status.status ?? status.workflow_status ?? status.workflowStatus ?? ""
  ).toLowerCase();
  return ["succeeded", "success", "complete", "completed", "failed", "failure", "cancelled", "canceled", "rejected"].includes(
    value
  );
}

function summarizeRegistrationState(status: Record<string, unknown>): string {
  const value = String(
    status.state ?? status.status ?? status.workflow_status ?? status.workflowStatus ?? "pending"
  );
  return `Cloudflare Registrar reports ${value}.`;
}
