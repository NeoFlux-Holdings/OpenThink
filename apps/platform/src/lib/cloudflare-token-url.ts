export interface CloudflareTokenPermissionPreset {
  key: string;
  type: "read" | "edit";
  label: string;
  reason: string;
  manualVerification?: string;
}

export const openThinkTokenPermissions: CloudflareTokenPermissionPreset[] = [
  {
    key: "workers_scripts",
    type: "edit",
    label: "Workers Scripts Edit",
    reason: "Upload and update the personal agent Worker."
  },
  {
    key: "artifacts",
    type: "edit",
    label: "Artifacts Edit",
    reason: "Create the optional per-agent Git workspace used for self-evolving code changes.",
    manualVerification:
      "If Cloudflare does not preselect this, manually add Account > Artifacts > Edit."
  },
  {
    key: "cloudchamber",
    type: "edit",
    label: "Containers Edit",
    reason: "Provision early Container-backed runtime support where Cloudflare still exposes this as Cloudchamber."
  },
  {
    key: "containers",
    type: "edit",
    label: "Containers Edit",
    reason: "Provision Container-backed services and Sandbox runtimes on Workers Paid accounts.",
    manualVerification:
      "If Cloudflare does not preselect this, manually add Account > Containers > Edit."
  },
  {
    key: "d1",
    type: "edit",
    label: "D1 Edit",
    reason: "Create the agent database and apply schema migrations."
  },
  {
    key: "workers_r2",
    type: "edit",
    label: "Workers R2 Storage Edit",
    reason: "Create and bind the artifact bucket.",
    manualVerification:
      "Confirm Cloudflare shows Account > Workers R2 Storage > Edit before creating the token."
  },
  {
    key: "queues",
    type: "edit",
    label: "Queues Edit",
    reason: "Create the agent task queue."
  },
  {
    key: "vectorize",
    type: "edit",
    label: "Vectorize Edit",
    reason: "Create the semantic memory index.",
    manualVerification:
      "Confirm Cloudflare shows Account > Vectorize > Edit before creating the token."
  },
  {
    key: "workers_ai",
    type: "read",
    label: "Workers AI Read",
    reason: "Bind Workers AI as the default model provider."
  },
  {
    key: "ai_gateway",
    type: "edit",
    label: "AI Gateway Edit",
    reason: "Let the agent create or update AI Gateway routes for BYOK/provider routing when requested.",
    manualVerification:
      "If Cloudflare does not preselect this, manually add Account > AI Gateway > Edit."
  },
  {
    key: "cloudflare_pages",
    type: "edit",
    label: "Cloudflare Pages Edit",
    reason: "Let the agent create and update Pages projects for static frontends and full-stack apps.",
    manualVerification:
      "If Cloudflare does not preselect this, manually add Account > Cloudflare Pages > Edit."
  },
  {
    key: "workers_kv_storage",
    type: "edit",
    label: "Workers KV Storage Edit",
    reason: "Let the agent provision KV namespaces when a new app needs low-latency key-value state.",
    manualVerification:
      "If Cloudflare does not preselect this, manually add Account > Workers KV Storage > Edit."
  },
  {
    key: "access",
    type: "edit",
    label: "Access Apps and Policies Edit",
    reason: "Create the Cloudflare Access app and allow policy for the deployed Worker."
  },
  {
    key: "zone",
    type: "read",
    label: "Zone Read",
    reason: "Discover zones for optional custom agent domains."
  },
  {
    key: "dns",
    type: "edit",
    label: "DNS Edit",
    reason: "Create or update an optional CNAME for a custom agent subdomain."
  },
  {
    key: "workers_routes",
    type: "edit",
    label: "Workers Routes Edit",
    reason: "Attach the deployed agent Worker to an optional custom route."
  },
  {
    key: "account_settings",
    type: "read",
    label: "Account Settings Read",
    reason: "Read account-level features and Workers subdomain metadata."
  },
  {
    key: "user_details",
    type: "read",
    label: "User Details Read",
    reason: "Let Cloudflare Dashboard validate the token owner during creation."
  }
];

export function buildOpenThinkTokenUrl(input: {
  accountId?: string;
  tokenName?: string;
} = {}): string {
  const url = new URL("https://dash.cloudflare.com/profile/api-tokens");
  url.searchParams.set(
    "permissionGroupKeys",
    JSON.stringify(
      openThinkTokenPermissions.map((permission) => ({
        key: permission.key,
        type: permission.type
      }))
    )
  );
  url.searchParams.set("accountId", input.accountId?.trim() || "*");
  url.searchParams.set("zoneId", "all");
  url.searchParams.set("name", input.tokenName?.trim() || "Open Think Personal Agent");
  return url.toString();
}
