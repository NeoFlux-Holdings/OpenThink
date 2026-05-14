# Hosted Cloud Agent Workflow

The hosted Cloud Agent is a deployed Cloudflare Worker that exposes a chat UI, a Cloudflare Agents SDK runtime, and a small HTTP SDK surface for other apps.

## End-to-end flow

1. Design the profile: choose the agent name, model, thinking level, personal-agent brain, enabled features, prompts, and tool approval policy.
2. Deploy the Worker: publish the Agents SDK runtime, asset-backed UI, Durable Object class, D1/R2/Queue bindings, and profile metadata.
3. Discover the runtime: call `/health`, `/manifest`, or `/cloud-agent/profile` to inspect readiness and capabilities.
4. Connect an app: use `@open-think/core` with `createHostedCloudAgentClient({ baseUrl })`.
5. Anchor work: call `/goal` or send `/goal ...` in chat so the agent has an active objective.
6. Coordinate the workspace: the default Workspace Orchestrator is auto-spun as a native Cloudflare sub-agent and stores project briefs in D1 workspace context, then indexes those briefs into Vectorize when `AI` and `VECTORIZE` bindings are connected.
7. Delegate: create sub-agent workstreams from templates or custom definitions, each with its own name, purpose, mode, brain, skills, system prompt, model, status, summary, message thread, and native sub-agent/RPC coordination path.
8. Operate: approve risky tools, summarize sub-agent state, reconcile updates, and restore or update the Worker from the platform.

## SDK

Install or depend on the workspace package:

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

const workspace = await agent.workspace();
await agent.addWorkspaceContext({
  text: "Customer launch review is the active workspace thread.",
  type: "goal"
});
await agent.addMemory("Prefer concise deploy-readiness briefs.");
const memories = await agent.searchMemory("deploy readiness");
const learning = await agent.learning();
if (learning.suggestions?.items[0]) {
  await agent.acceptLearningSuggestion(learning.suggestions.items[0].id);
}
const artifacts = await agent.listArtifacts();
const snapshot = await agent.browserSnapshot({
  url: "https://developers.cloudflare.com/agents/"
});
const browserDiagnostics = await agent.browserDiagnostics();
const liveBrowserDiagnostics = await agent.browser.diagnostics({ live: true });
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
const executor = await agent.executorStatus();
const diff = await agent.executor.captureDiff({ pathspec: ["src", "docs"] });
if (diff.artifactKey) {
  await agent.createContributionPullRequest({
    title: "Apply Sandbox changes",
    diffArtifactKeys: [diff.artifactKey]
  });
}
console.log(workspace.workspace.contextSummary, memories.memories.length, learning.trainMode.available, artifacts.available, snapshot.artifactKey, browserDiagnostics.status, liveBrowserDiagnostics.status, browser.summary, frameStatus?.status, frameStream, contribution.repository, executor.status, diff.artifactKey);
```

The SDK covers:

- `health()` and `manifest()` for readiness and endpoint discovery.
- `profile()` for the Cloud Agent Instance profile.
- `goal(goal)` for active objective setup.
- `listSubAgents()`, `createSubAgent()`, `getSubAgent()`, `sendSubAgentMessage()`, `controlSubAgent()`, and `summarizeSubAgent()`.
- `workspace()` for orchestrator state and durable workspace context.
- `addWorkspaceContext()` for durable workstream notes that should not pollute the main chat transcript.
- `listSkills()`, `listMemory()`, `searchMemory()`, `addMemory()`, `listArtifacts()`, `getArtifact()`, `putArtifact()`, `listFiles()`, `getFile()`, `putFile()`, `listTasks()`, `createTask()`, `browserSnapshot()`, `browserDiagnostics()` / `agent.browser.diagnostics()`, `listBrowserSessions()`, `createBrowserSession()`, `browserFrameStreamStatus()` / `agent.browser.frameStreamStatus()`, `browserFrameStreamUrl()` / `agent.browser.frameStreamUrl()`, `listBrowserSessionTargets()`, `createBrowserSessionTarget()`, `closeBrowserSession()`, `contributions()`, and `createContributionPullRequest()` for library, memory, artifact previews, file workspace state, task queue tracking, Browser Run snapshot/live-session artifacts, credential/API/live-frame self-tests, same-origin 4fps target frame streams when CDP websocket URLs are available, frame-stream readiness diagnostics, artifact revision workflows, `.diff`/`.patch` review artifacts via `@pierre/diffs`, and owner-approved upstream PRs from explicit file changes, artifact keys, or captured Sandbox diff artifacts.
- `learning()`, `createLearningSuggestion()`, `acceptLearningSuggestion()`, `rejectLearningSuggestion()`, and `curateLearningSuggestion()` for train/teach-mode readiness plus pending memory, skill, rubric, or workflow review items.
- `executorStatus()`, `agent.executor.captureDiff()`, `listMcpServers()`, `mcpObservability()`, `listMcpTools()`, and `callMcpTool()` for execution-plane discovery, reviewable Sandbox diff artifacts, and recent MCP/tool activity.
- `runtimeContext()` and `personalAgentSetup()` for setup and customization reads.

The deployed composer exposes `Auto`, `Plan first`, and `Train`. `Train` opens an editable plan panel before any mutating work runs: users can edit the objective, add/remove/reorder steps, approve all steps, or switch to step-by-step approval. Approved plans are sent through `/train` with skill-save follow-up instructions.

The deployed starter shell follows the Persona layout: workspace navigation on the left, the live thread in the center, command-palette search with `Ctrl+K`, and an artifact canvas on the right for generated artifacts, learning, skills, executor status, runtime controls, and sub-agent tracking.

## Customization

Personal agent customization is available at deployment time and through Worker environment/configuration:

- Agent identity: `agentName`, deployment id, default model, thinking level.
- Brain: preset, custom name, custom soul prompt, launch brief, and enabled gbrain/gstack features.
- Skills: built-in gskills, Cloudflare MCP, first-party Sandbox executor tools including `sandbox_diff`, files, memory, tasks, semantic recall, and a skill source catalog.
- Safety: MCP policy can be `auto`, `ask-every-time`, `allow-all`, or `full-auto`. `allow-all` is the legacy alias for full automatic approval.
- Execution: Agents SDK is the chat/state/orchestration runtime. Executor is the default execution-plane contract and generated deployments include a same-Worker Cloudflare Sandbox/Containers bridge over RPC.
- Executor target: the default OpenThink target is the deployed Worker itself (`/mcp/tools?server=executor` and `/mcp/call`). `OPEN_THINK_EXECUTOR_MCP_URL` is optional for a self-hosted or executor.sh-compatible external MCP service.
- Browser Run: the `browser_snapshot` tool calls Cloudflare Browser Rendering `/snapshot` with `OPEN_THINK_CF_API_TOKEN` and stores a `*.browser.json` artifact containing screenshot and rendered HTML preview data. `/browser/diagnostics` has a read-only configuration/API check and an explicit live check that creates a short-lived session, verifies target/CDP frame capture, and closes the session. The `browser_session` tool and `/browser/sessions` endpoints use the Browser Run CDP session-management API to create/list/close live sessions and tabs, returning `devtoolsFrontendUrl` Live View links for owner takeover. Browser-session artifacts attempt inline Live View rendering in the artifact canvas and keep the external link as fallback.
- Code Mode: Cloudflare API MCP defaults to `https://mcp.cloudflare.com/mcp?codemode=search_and_execute`, exposing the compact search/execute shape instead of thousands of individual tools.
- Sub-agents: each child can set purpose, mode, brain, skills, system prompt, and model. Built-in templates cover research scout, builder, reviewer, and Cloud operator workstreams. Package deployments keep D1 as the control/history surface while executing messages through native `OpenThinkSubAgent` child Agents via `subAgent()` typed RPC. The default `OpenThinkWorkspaceMcp` server is also bound as `WORKSPACE_MCP` and registered through `addMcpServer()` for same-Worker MCP RPC between the main agent, workspace orchestrator, and sub-agent control plane.
- Workspace: the default workspace preloads Cloudflare skills from `cloudflare/skills`, `llms-full.txt`, Agents docs, and Workers best practices, then exposes optional catalog sources for `aihero.dev/skills.md`, `anthropics/skills`, and `openai/skills`. It keeps durable briefs in `/workspace`. D1 remains the source of truth; Vectorize semantic recall is best-effort and falls back to D1 text search if embeddings, bindings, or index dimensions are unavailable.

## Runtime endpoints

Primary Agents SDK deployments expose:

- `/health`
- `/manifest`
- `/cloud-agent/profile`
- `/goal`
- `/subagents`
- `/subagents/{id}`
- `/subagents/{id}/messages`
- `/subagents/{id}/control`
- `/subagents/{id}/summary`
- `/skills`
- `/memory`
- `/artifacts`
- `/files`
- `/tasks`
- `/browser/snapshot`
- `/browser/diagnostics`
- `/browser/sessions`
- `/browser/sessions/{sessionId}`
- `/browser/sessions/{sessionId}/targets`
- `/browser/sessions/{sessionId}/targets/{targetId}`
- `/contributions`
- `/learning`
- `/learning/{id}`
- `/executor`
- `/mcp/servers`
- `/mcp/state`
- `/mcp/add`
- `/mcp/tools`
- `/mcp/call`
- `/mcp/observability`
- `/personal-agent/setup`
- `/runtime/context`
- `/workspace`

Raw Worker fallback deployments expose the same hosted-agent discovery and sub-agent control endpoints, with chat over SSE/JSON instead of Agents SDK WebSocket chat.
