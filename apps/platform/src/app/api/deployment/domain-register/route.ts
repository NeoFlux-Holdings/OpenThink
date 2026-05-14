import {
  CloudflareApiClient,
  CloudflareApiError,
  inspectCloudflareToken,
  type RegistrarDomainResult
} from "@/lib/cloudflare-api";

interface DomainRegisterPayload {
  cfApiToken?: string;
  cloudflareAccountId?: string;
  domain?: string;
  confirmation?: string;
  maxRegistrationCost?: string | number;
  expectedCurrency?: string;
  autoRenew?: boolean;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json().catch(() => ({}))) as DomainRegisterPayload;
    const token = payload.cfApiToken?.trim();
    if (!token) {
      return Response.json({ error: "Cloudflare API token is required." }, { status: 400 });
    }

    const domain = normalizeDomainName(payload.domain);
    if (!domain) {
      return Response.json(
        { error: "Choose an exact domain name before registration." },
        { status: 400 }
      );
    }

    const expectedConfirmation = `REGISTER ${domain}`;
    if (payload.confirmation?.trim() !== expectedConfirmation) {
      return Response.json(
        {
          error: `Type ${expectedConfirmation} to confirm this billable, non-refundable registration.`
        },
        { status: 400 }
      );
    }

    const maxCost = parseMoney(payload.maxRegistrationCost);
    if (maxCost === null) {
      return Response.json(
        { error: "Set a maximum registration price before purchasing the domain." },
        { status: 400 }
      );
    }

    const inspection = await inspectCloudflareToken({ apiToken: token });
    const accountId = payload.cloudflareAccountId?.trim() || inspection.defaultAccountId;
    if (!accountId) {
      return Response.json(
        { error: "Choose a Cloudflare account before registering a domain." },
        { status: 400 }
      );
    }

    const client = new CloudflareApiClient({
      accountId,
      apiToken: token
    });
    await client.verifyAccountAccess();

    const check = await client.checkRegistrarDomains([domain]);
    const candidate = check.domains.find((item) => item.name.toLowerCase() === domain);
    const guard = validateRegistrationCandidate(candidate, maxCost, payload.expectedCurrency);
    if (guard) {
      return Response.json(
        {
          error: guard,
          accountId,
          check
        },
        { status: 409 }
      );
    }

    const registration = await client.registerRegistrarDomain({
      domainName: domain,
      autoRenew: payload.autoRenew === true,
      preferAsync: true
    });

    return Response.json(
      {
        accountId,
        check,
        registration,
        poll: {
          platformPath: "/api/deployment/domain-status",
          cloudflareStatusPath: `/accounts/${accountId}/registrar/registrations/${domain}/registration-status`,
          cloudflare: registration.links?.self
        },
        message:
          "Registration submitted to Cloudflare Registrar. Poll the registration status until it reaches a terminal state."
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
        error: error instanceof Error ? error.message : "Domain registration failed.",
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

function validateRegistrationCandidate(
  candidate: RegistrarDomainResult | undefined,
  maxCost: number,
  expectedCurrency?: string
): string | null {
  if (!candidate) {
    return "Cloudflare Registrar did not return this domain in the authoritative check.";
  }
  if (!candidate.registrable) {
    return candidate.reason
      ? `This domain is not registrable through the API: ${candidate.reason}.`
      : "This domain is not registrable through the API.";
  }
  if (candidate.tier?.toLowerCase() === "premium") {
    return "Premium domains are not supported by the Registrar API.";
  }

  const cost = parseMoney(candidate.pricing?.registration_cost);
  if (cost === null) {
    return "Cloudflare Registrar did not return a registration price; stop before purchase.";
  }
  if (cost > maxCost) {
    return `The latest registration price ${formatMoney(candidate.pricing?.currency, cost)} exceeds your maximum ${formatMoney(candidate.pricing?.currency, maxCost)}.`;
  }
  if (
    expectedCurrency &&
    candidate.pricing?.currency &&
    candidate.pricing.currency.toUpperCase() !== expectedCurrency.toUpperCase()
  ) {
    return `The latest price is in ${candidate.pricing.currency}, not ${expectedCurrency}.`;
  }

  return null;
}

function normalizeDomainName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    return null;
  }
  return domain;
}

function parseMoney(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatMoney(currency: string | undefined, value: number): string {
  return `${currency ?? "USD"} ${value.toFixed(2)}`;
}
