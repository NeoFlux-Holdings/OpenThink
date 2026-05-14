import {
  CloudflareApiClient,
  CloudflareApiError,
  inspectCloudflareToken
} from "@/lib/cloudflare-api";

interface DomainCheckPayload {
  cfApiToken?: string;
  cloudflareAccountId?: string;
  query?: string;
  domains?: string[];
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json().catch(() => ({}))) as DomainCheckPayload;
    const token = payload.cfApiToken?.trim();
    if (!token) {
      return Response.json({ error: "Cloudflare API token is required." }, { status: 400 });
    }

    const inspection = await inspectCloudflareToken({ apiToken: token });
    const accountId = payload.cloudflareAccountId?.trim() || inspection.defaultAccountId;
    if (!accountId) {
      return Response.json(
        { error: "Choose a Cloudflare account before checking Registrar availability." },
        { status: 400 }
      );
    }

    const client = new CloudflareApiClient({
      accountId,
      apiToken: token
    });
    await client.verifyAccountAccess();

    const query = payload.query?.trim();
    const domains = (payload.domains ?? [])
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);

    if (!query && domains.length === 0) {
      return Response.json(
        { error: "Enter a search phrase or an exact domain to check." },
        { status: 400 }
      );
    }

    const [search, check] = await Promise.all([
      query ? client.searchRegistrarDomains({ query, limit: 5 }) : Promise.resolve({ domains: [] }),
      domains.length ? client.checkRegistrarDomains(domains) : Promise.resolve({ domains: [] })
    ]);

    return Response.json(
      {
        accountId,
        search,
        check,
        purchasePrerequisites: [
          "Cloudflare account billing profile with a default payment method.",
          "Default registrant contact configured.",
          "Domain Registration Agreement accepted in Cloudflare Dashboard.",
          "Registrar Write permission on this API token."
        ]
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
        error: error instanceof Error ? error.message : "Domain availability check failed.",
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
