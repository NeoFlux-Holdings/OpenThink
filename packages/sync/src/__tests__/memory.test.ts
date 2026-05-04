import { describe, expect, it } from "vitest";
import { MemoryRepoSyncService } from "../memory";
import type { SyncConfig } from "../types";

const config: SyncConfig = {
  sourceOfTruth: "local-dev",
  branch: "main",
  authorName: "Test",
  authorEmail: "test@example.com",
  autoSync: {
    enabled: true,
    direction: "bidirectional",
    intervalSeconds: 60
  }
};

describe("MemoryRepoSyncService", () => {
  it("tracks draft changes, commits, pushes, and deploys", async () => {
    const service = new MemoryRepoSyncService(config);
    await service.writeFile({
      path: "worker.js",
      content: "export default { fetch: () => new Response('changed') };"
    });

    expect((await service.status()).dirtyFiles).toContain("worker.js");
    const commit = await service.commit("Change worker");
    expect(commit.commitSha).toBeTruthy();
    const deploy = await service.deploy();
    expect(deploy.status.deployedHead).toBe(deploy.deployedSha);
  });
});
