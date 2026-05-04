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
    key: "cloudchamber",
    type: "edit",
    label: "Containers Edit",
    reason: "Provision Container-backed runtime support when available."
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
