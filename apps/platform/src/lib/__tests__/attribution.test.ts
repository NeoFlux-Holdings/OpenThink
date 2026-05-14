import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openThinkCanonicalRepository } from "../update-source";

const repoRoot = resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));
const generatedTextSurfaces = [
  "apps/platform/src/lib/sync-service.ts",
  "apps/platform/src/lib/agent-worker-template.ts",
  "apps/platform/src/lib/agents-sdk-runtime-template.ts",
  "packages/sync/src/config.ts",
  "packages/core/src/cloud-agent.ts",
  "packages/core/README.md",
  "README.md"
];

const forbiddenAttributionPatterns = [
  /co-authored-by:\s*claude/i,
  /generated\s+with\s+claude/i,
  /created\s+by\s+claude/i,
  /authored\s+by\s+claude/i,
  /claude\s+code/i
];

describe("generated attribution", () => {
  it("does not add Claude attribution to generated commit, PR, runtime, or SDK text", () => {
    for (const file of generatedTextSurfaces) {
      const text = readFileSync(resolve(repoRoot, file), "utf8");
      for (const pattern of forbiddenAttributionPatterns) {
        expect(text, file + " should not match " + pattern).not.toMatch(pattern);
      }
    }
  });

  it("keeps generated source and update flows pointed at the current OpenThink repository", () => {
    const alternateImplementationPattern = new RegExp(["open", "think2"].join(""), "i");
    expect(openThinkCanonicalRepository).toBe("NeoFlux-Holdings/OpenThink");
    for (const file of generatedTextSurfaces) {
      const text = readFileSync(resolve(repoRoot, file), "utf8");
      expect(text, file + " should not reference the separate implementation").not.toMatch(
        alternateImplementationPattern
      );
    }
  });
});
