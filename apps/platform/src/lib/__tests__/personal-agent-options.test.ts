import { describe, expect, it } from "vitest";
import {
  normalizePersonalAgentConfig,
  normalizePersonalAgentToolApprovalPolicy,
  personalAgentPublicConfigBindingText,
  personalAgentSetupSql
} from "../personal-agent-options";

describe("personal agent options", () => {
  it("normalizes the native gbrain/gstack setup", () => {
    const config = normalizePersonalAgentConfig({
      enabled: true,
      presetId: "openthink-gbrain-gstack"
    });

    expect(config.enabled).toBe(true);
    expect(config.label).toBe("OpenThink gbrain + gstack");
    expect(config.setupStatus).toBe("complete");
    expect(config.toolApprovalPolicy).toBe("auto");
    expect(config.enabledFeatures).toContain("semanticMemory");
    expect(config.enabledFeatures).toContain("mcpBridge");
  });

  it("redacts the soul prompt from the public Worker config binding", () => {
    const binding = JSON.parse(
      personalAgentPublicConfigBindingText({
        enabled: true,
        presetId: "custom",
        toolApprovalPolicy: "ask-every-time",
        customName: "Research .brain",
        soulPrompt: "Always prefer primary sources.",
        launchBrief: "Start by indexing the docs workspace."
      })
    ) as Record<string, unknown>;

    expect(binding.soulPrompt).toBeUndefined();
    expect(binding.launchBrief).toBeUndefined();
    expect(binding.soulPromptConfigured).toBe(true);
    expect(binding.launchBriefConfigured).toBe(true);
    expect(binding.toolApprovalPolicy).toBe("ask-every-time");
  });

  it("normalizes tool approval policy aliases to the default-safe enum", () => {
    expect(normalizePersonalAgentToolApprovalPolicy("ask everytime")).toBe("ask-every-time");
    expect(normalizePersonalAgentToolApprovalPolicy("allow all")).toBe("allow-all");
    expect(normalizePersonalAgentToolApprovalPolicy("always approve")).toBe("full-auto");
    expect(normalizePersonalAgentToolApprovalPolicy("unknown")).toBe("auto");
  });

  it("builds setup SQL for enabled profiles only", () => {
    expect(personalAgentSetupSql({ enabled: false }, "agent-test")).toBeUndefined();

    const sql = personalAgentSetupSql(
      {
        enabled: true,
        presetId: "memmachine"
      },
      "agent-test",
      "2026-05-05T00:00:00.000Z"
    );

    expect(sql).toContain("create table if not exists personal_agent_setup");
    expect(sql).toContain("create table if not exists personal_agent_feature_flags");
    expect(sql).toContain("insert or replace into personal_agent_feature_flags");
    expect(sql).toContain("memmachine");
    expect(sql).toContain("external-runtime-needed");
    expect(sql).toContain("MCP tool approval policy auto");
  });

  it("seeds launch brief memory separately from the soul prompt", () => {
    const sql = personalAgentSetupSql(
      {
        enabled: true,
        presetId: "custom",
        customName: "Field Brain",
        soulPrompt: "Keep a stable operating identity.",
        launchBrief: "Start with project Apollo triage."
      },
      "agent-test",
      "2026-05-05T00:00:00.000Z"
    );

    expect(sql).toContain("setup:agent-test:personal-agent");
    expect(sql).toContain("setup:agent-test:launch-brief");
    expect(sql).toContain("Initial launch brief for Field Brain");
    expect(sql).not.toContain("Keep a stable operating identity.");
  });
});
