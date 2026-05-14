import { describe, expect, it } from "vitest";
import {
  CloudflareConfigurationError,
  CloudflareApiClient,
  resolveCloudflareAccountIdFromToken
} from "../cloudflare-api";

describe("CloudflareApiClient", () => {
  it("creates missing resources through account-scoped endpoints", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      const call: { url: string; init?: RequestInit } = { url: String(url) };
      if (init) call.init = init;
      calls.push(call);

      if (String(url).endsWith("/d1/database")) {
        return json({ result: [] });
      }

      if (String(url).includes("/r2/buckets/open-think-test")) {
        return json({ errors: [{ message: "missing" }], success: false }, 404);
      }

      if (String(url).endsWith("/r2/buckets")) {
        return json({ result: { name: "open-think-test" } });
      }

      if (String(url).endsWith("/queues")) {
        if (init?.method === "POST") {
          return json({ result: { queue_id: "queue-id", queue_name: "open-think-test" } });
        }
        return json({ result: [] });
      }

      if (String(url).includes("/vectorize/v2/indexes/open-think-test")) {
        return json({ errors: [{ message: "missing" }], success: false }, 404);
      }

      if (String(url).endsWith("/vectorize/v2/indexes")) {
        return json({ result: { name: "open-think-test" } });
      }

      return json({ result: { name: "open-think-test", uuid: "d1-id" } });
    };

    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher
    });

    await client.ensureD1Database("open-think-test");
    await client.ensureR2Bucket("open-think-test");
    await client.ensureQueue("open-think-test");
    await client.ensureVectorizeIndex("open-think-test");

    expect(calls.some((call) => call.url.endsWith("/accounts/acct/d1/database"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/accounts/acct/r2/buckets"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/accounts/acct/queues"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/accounts/acct/vectorize/v2/indexes"))).toBe(true);
  });

  it("enables workers.dev and creates an Access application", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      const call: { url: string; init?: RequestInit } = { url: String(url) };
      if (init) call.init = init;
      calls.push(call);

      if (String(url).endsWith("/workers/subdomain")) {
        return json({ result: { subdomain: "example-account" } });
      }

      if (String(url).endsWith("/workers/scripts/open-think-test/subdomain")) {
        return json({ result: { enabled: true, previews_enabled: true } });
      }

      if (String(url).endsWith("/access/apps")) {
        return json({
          result: {
            id: "access-app-id",
            domain: "open-think-test.example-account.workers.dev",
            policies: [{ id: "policy-id" }]
          }
        });
      }

      return json({ result: {} });
    };

    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher
    });

    await client.enableWorkerSubdomain("open-think-test");
    const subdomain = await client.getWorkersSubdomain();
    const app = await client.createAccessApplication({
      name: "Open Think Test",
      domain: "open-think-test.example-account.workers.dev",
      allowedEmails: ["owner@example.com"]
    });

    expect(subdomain).toBe("example-account");
    expect(app.id).toBe("access-app-id");
    expect(calls.some((call) => call.url.endsWith("/workers/scripts/open-think-test/subdomain"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/access/apps"))).toBe(true);
  });

  it("reuses an existing Access application for the same domain", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      const call: { url: string; init?: RequestInit } = { url: String(url) };
      if (init) call.init = init;
      calls.push(call);

      if (String(url).endsWith("/access/apps") && init?.method === "POST") {
        return json(
          { errors: [{ message: "access.api.error.application_already_exists" }], success: false },
          409
        );
      }

      if (String(url).endsWith("/access/apps?per_page=100")) {
        return json({
          result: [
            {
              id: "existing-access-app-id",
              name: "Existing Agent",
              domain: "open-think-test.example-account.workers.dev",
              policies: [{ id: "policy-id" }]
            }
          ]
        });
      }

      if (String(url).endsWith("/access/apps/existing-access-app-id") && init?.method === "PUT") {
        return json({
          result: {
            id: "existing-access-app-id",
            name: "Existing Agent",
            domain: "open-think-test.example-account.workers.dev",
            policies: [{ id: "policy-id" }]
          }
        });
      }

      return json({ result: {} });
    };

    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher
    });

    const app = await client.createAccessApplication({
      name: "Open Think Test",
      domain: "open-think-test.example-account.workers.dev",
      allowedEmails: ["owner@example.com"]
    });

    expect(app.id).toBe("existing-access-app-id");
    expect(calls.some((call) => call.url.endsWith("/access/apps?per_page=100"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/access/apps/existing-access-app-id") && call.init?.method === "PUT")).toBe(true);
  });

  it("upserts a custom domain CNAME and Workers route", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      const call: { url: string; init?: RequestInit } = { url: String(url) };
      if (init) call.init = init;
      calls.push(call);

      if (String(url).includes("/dns_records?")) {
        return json({ result: [] });
      }

      if (String(url).endsWith("/dns_records")) {
        return json({ result: { id: "dns-id", name: "agent.example.com", type: "CNAME", content: "target.workers.dev" } });
      }

      if (String(url).includes("/workers/routes?")) {
        return json({ result: [] });
      }

      if (String(url).endsWith("/workers/routes")) {
        return json({ result: { id: "route-id", pattern: "agent.example.com/*", script: "open-think-agent" } });
      }

      return json({ result: {} });
    };

    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher
    });

    const dns = await client.upsertCnameRecord({
      zoneId: "zone",
      hostname: "Agent.Example.com",
      target: "target.workers.dev"
    });
    const route = await client.ensureWorkerRoute({
      zoneId: "zone",
      hostname: "Agent.Example.com",
      scriptName: "open-think-agent"
    });

    expect(dns.id).toBe("dns-id");
    expect(route.id).toBe("route-id");
    expect(calls.some((call) => call.url.includes("/zones/zone/dns_records"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/zones/zone/workers/routes"))).toBe(true);
  });

  it("adds operation and permission context to Cloudflare authentication errors", async () => {
    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher: async () =>
        json({ errors: [{ code: 10000, message: "Authentication error" }], success: false }, 403)
    });

    await expect(client.verifyAccountAccess()).rejects.toMatchObject({
      message: expect.stringContaining("Verify Cloudflare account access failed: Authentication error"),
      operation: "Verify Cloudflare account access",
      requiredPermission: "Account Settings Read"
    });
  });

  it("verifies deploy-critical provisioning permissions before launch", async () => {
    const calls: string[] = [];
    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher: async (url) => {
        calls.push(String(url));
        return json({ result: [] });
      }
    });

    await client.verifyProvisioningPermissions();

    expect(calls).toEqual(
      expect.arrayContaining([
        "https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts?per_page=1",
        "https://api.cloudflare.com/client/v4/accounts/acct/access/apps?per_page=1",
        "https://api.cloudflare.com/client/v4/accounts/acct/d1/database",
        "https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets",
        "https://api.cloudflare.com/client/v4/accounts/acct/queues",
        "https://api.cloudflare.com/client/v4/accounts/acct/vectorize/v2/indexes"
      ])
    );
  });

  it("checks Cloudflare Registrar domain availability through account-scoped endpoints", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher: async (url, init) => {
        const call: { url: string; init?: RequestInit } = { url: String(url) };
        if (init) call.init = init;
        calls.push(call);
        if (String(url).includes("/registrar/domain-search")) {
          return json({
            result: {
              domains: [
                {
                  name: "orbitforge.dev",
                  registrable: true,
                  pricing: { currency: "USD", registration_cost: "10.11" }
                }
              ]
            }
          });
        }
        return json({
          result: {
            domains: [
              {
                name: "orbitforge.dev",
                registrable: true,
                pricing: { currency: "USD", registration_cost: "10.11" }
              }
            ]
          }
        });
      }
    });

    const search = await client.searchRegistrarDomains({ query: "orbit forge", limit: 3 });
    const check = await client.checkRegistrarDomains(["OrbitForge.dev"]);

    expect(search.domains[0]?.name).toBe("orbitforge.dev");
    expect(check.domains[0]?.registrable).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/registrar/domain-search?q=orbit+forge&limit=3"
    );
    expect(calls[1]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/registrar/domain-check"
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ domains: ["orbitforge.dev"] }));
  });

  it("registers a Registrar domain with explicit async preference", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher: async (url, init) => {
        const call: { url: string; init?: RequestInit } = { url: String(url) };
        if (init) call.init = init;
        calls.push(call);
        return json({
          result: {
            domain_name: "orbitforge.dev",
            status: "pending",
            links: { self: "/accounts/acct/registrar/registrations/orbitforge.dev" }
          }
        });
      }
    });

    const registration = await client.registerRegistrarDomain({
      domainName: "OrbitForge.dev",
      autoRenew: false,
      preferAsync: true
    });

    expect(registration.domain_name).toBe("orbitforge.dev");
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/registrar/registrations"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({ Prefer: "respond-async" });
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ domain_name: "orbitforge.dev", auto_renew: false })
    );
  });

  it("reads Registrar registration workflow status", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new CloudflareApiClient({
      accountId: "acct",
      apiToken: "token",
      fetcher: async (url, init) => {
        const call: { url: string; init?: RequestInit } = { url: String(url) };
        if (init) call.init = init;
        calls.push(call);
        return json({
          result: {
            domain_name: "orbitforge.dev",
            state: "succeeded"
          }
        });
      }
    });

    const status = await client.getRegistrarRegistrationStatus("OrbitForge.dev");

    expect(status.state).toBe("succeeded");
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/registrar/registrations/orbitforge.dev/registration-status"
    );
  });

  it("resolves a single visible account from a token", async () => {
    const accountId = await resolveCloudflareAccountIdFromToken({
      apiToken: "token",
      baseUrl: "https://api.example.test",
      fetcher: async () => json({ result: [{ id: "acct", name: "Open Think" }] })
    });

    expect(accountId).toBe("acct");
  });

  it("requires explicit account id when a token can access multiple accounts", async () => {
    await expect(
      resolveCloudflareAccountIdFromToken({
        apiToken: "token",
        baseUrl: "https://api.example.test",
        fetcher: async () =>
          json({
            result: [
              { id: "acct-a", name: "A" },
              { id: "acct-b", name: "B" }
            ]
          })
      })
    ).rejects.toBeInstanceOf(CloudflareConfigurationError);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, ...(body as object) }), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
