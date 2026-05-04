import { describe, expect, it } from "vitest";
import { buildOpenThinkTokenUrl } from "../cloudflare-token-url";

describe("buildOpenThinkTokenUrl", () => {
  it("preloads account, name, and required permission groups", () => {
    const url = new URL(
      buildOpenThinkTokenUrl({
        accountId: "acct",
        tokenName: "Open Think Test"
      })
    );
    const permissions = JSON.parse(url.searchParams.get("permissionGroupKeys") ?? "[]") as Array<{
      key: string;
      type: string;
    }>;

    expect(url.searchParams.get("accountId")).toBe("acct");
    expect(url.searchParams.get("name")).toBe("Open Think Test");
    expect(permissions).toContainEqual({ key: "workers_scripts", type: "edit" });
    expect(permissions).toContainEqual({ key: "workers_r2", type: "edit" });
    expect(permissions).toContainEqual({ key: "access", type: "edit" });
    expect(permissions).toContainEqual({ key: "containers", type: "edit" });
    expect(permissions).toContainEqual({ key: "cloudchamber", type: "edit" });
    expect(permissions).toContainEqual({ key: "cloudflare_pages", type: "edit" });
    expect(permissions).toContainEqual({ key: "workers_kv_storage", type: "edit" });
    expect(permissions).toContainEqual({ key: "ai_gateway", type: "edit" });
    expect(permissions).toContainEqual({ key: "d1", type: "edit" });
    expect(permissions).toContainEqual({ key: "dns", type: "edit" });
    expect(permissions).toContainEqual({ key: "workers_routes", type: "edit" });
    expect(permissions).toContainEqual({ key: "zone", type: "read" });
    expect(permissions).not.toContainEqual({ key: "workers_r2_storage", type: "edit" });
  });
});
