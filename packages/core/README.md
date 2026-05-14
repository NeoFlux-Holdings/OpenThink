# @open-think/core

Typed SDK and runtime contracts for hosted OpenThink Cloud Agent instances.

## Install

```bash
pnpm add @open-think/core
```

## Connect to a Hosted Agent

```ts
import { createHostedCloudAgentClient } from "@open-think/core";

const agent = createHostedCloudAgentClient({
  baseUrl: "https://your-agent.workers.dev"
});

const profile = await agent.profile();
await agent.goal("Ship the first customer workflow");

const child = await agent.createSubAgent({
  name: "Deploy scout",
  purpose: "Check deploy readiness and summarize blockers",
  mode: "hybrid",
  skills: ["cloudflare", "release", "testing"]
});

await agent.sendSubAgentMessage(child.subAgent.id, "Inspect the current deploy path.");
await agent.addWorkspaceContext({
  type: "goal",
  text: "Customer launch review is the active workspace thread."
});

const learning = await agent.learning();
if (learning.suggestions?.items[0]) {
  await agent.acceptLearningSuggestion(learning.suggestions.items[0].id);
}
const artifacts = await agent.listArtifacts();
await agent.putFile("notes/deploy.md", "# Deploy notes");
await agent.createTask({ title: "Follow release checklist", payload: { lane: "release" } });
const snapshot = await agent.browserSnapshot({
  url: "https://developers.cloudflare.com/agents/"
});

const browserCheck = await agent.browserDiagnostics();
const liveBrowserCheck = await agent.browser.diagnostics({ live: true });
const browser = await agent.createBrowserSession({
  url: "https://developers.cloudflare.com/browser-run/",
  targets: true
});
const firstTargetId = browser.target?.id || browser.targets?.[0]?.id;
const frameStatus = browser.sessionId && firstTargetId
  ? await agent.browser.frameStreamStatus(browser.sessionId, firstTargetId, { fps: 4 })
  : null;
const frameStream = browser.sessionId && firstTargetId
  ? agent.browser.frameStreamUrl(browser.sessionId, firstTargetId, { fps: 4 })
  : null;
const contribution = await agent.contributions();
const executorTools = await agent.executor.listTools();
const diff = await agent.executor.captureDiff({ pathspec: ["src", "docs"] });
if (diff.artifactKey) {
  await agent.createContributionPullRequest({
    title: "Apply Sandbox changes",
    diffArtifactKeys: [diff.artifactKey]
  });
}
console.log(profile.kind, learning.trainMode.available, artifacts.available, snapshot.artifactKey, browser.summary, frameStatus?.status, frameStream, contribution.repository, executorTools.available, diff.artifactKey);
```

## Surface

- Discovery: `health()`, `manifest()`, `profile()`, `runtimeContext()`, `personalAgentSetup()`.
- Goals and train mode: `goal()` plus runtime `/train` support from the hosted UI.
- Workspace: `workspace()` and `addWorkspaceContext()`.
- Sub-agents: `listSubAgents()`, `createSubAgent()`, `sendSubAgentMessage()`, `controlSubAgent()`, `summarizeSubAgent()`.
- Capabilities: `listSkills()`, `listMemory()`, `addMemory()`, `listArtifacts()`, `getArtifact()` with version metadata, `putArtifact()` with runtime revision snapshots, `listFiles()`, `getFile()`, `getFileJson()`, `putFile()`, `listTasks()`, `createTask()`, `browserSnapshot()` for Browser Run screenshot plus HTML artifacts, `browserDiagnostics()` / `agent.browser.diagnostics()` for Browser Run credential/API/live-frame self-tests, `listBrowserSessions()`, `createBrowserSession()`, `listBrowserSessionTargets()`, `createBrowserSessionTarget()`, `browserFrameStreamStatus()` / `agent.browser.frameStreamStatus()` for CDP stream readiness checks, `browserFrameStreamUrl()` / `agent.browser.frameStreamUrl()` for same-origin Browser Run screenshot streams, `closeBrowserSession()`, `contributions()`, `createContributionPullRequest()` from direct file changes, stored artifacts, or captured `diffArtifactKeys`, `learning()`, `createLearningSuggestion()`, `acceptLearningSuggestion()`, `rejectLearningSuggestion()`, `curateLearningSuggestion()`.
- Execution and MCP: `executorStatus()`, `agent.executor.status()`, `agent.executor.listTools()`, `agent.executor.captureDiff()`, `agent.executor.callTool()`, `listMcpServers()`, `mcpState()`, `mcpObservability()`, `addMcpServer()`, `listMcpTools()`, `callMcpTool()`.

Every deployed agent should expose `/manifest` and `/cloud-agent/profile` so integrations can discover which optional surfaces are configured before calling them.
