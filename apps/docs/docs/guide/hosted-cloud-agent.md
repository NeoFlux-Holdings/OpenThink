# Hosted Cloud Agent Workflow

The hosted Cloud Agent is a deployed Cloudflare Worker that exposes a chat UI, a Cloudflare Agents SDK runtime, and a small HTTP SDK surface for other apps.

## End-to-end flow

1. Design the profile: choose the agent name, model, thinking level, personal-agent brain, enabled features, prompts, and tool approval policy.
2. Deploy the Worker: publish the Agents SDK runtime, asset-backed UI, Durable Object class, D1/R2/Queue bindings, and profile metadata.
3. Discover the runtime: call `/health`, `/manifest`, or `/cloud-agent/profile` to inspect readiness and capabilities.
4. Connect an app: use `@open-think/core` with `createHostedCloudAgentClient({ baseUrl })`.
5. Anchor work: call `/goal` or send `/goal ...` in chat so the agent has an active objective.
6. Delegate: create sub-agent workstreams from templates or custom definitions, each with its own name, purpose, mode, brain, skills, system prompt, model, status, summary, and message thread.
7. Operate: approve risky tools, summarize sub-agent state, reconcile updates, and restore or update the Worker from the platform.

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
```

The SDK covers:

- `health()` and `manifest()` for readiness and endpoint discovery.
- `profile()` for the Cloud Agent Instance profile.
- `goal(goal)` for active objective setup.
- `listSubAgents()`, `createSubAgent()`, `getSubAgent()`, `sendSubAgentMessage()`, `controlSubAgent()`, and `summarizeSubAgent()`.
- `runtimeContext()` and `personalAgentSetup()` for setup and customization reads.

## Customization

Personal agent customization is available at deployment time and through Worker environment/configuration:

- Agent identity: `agentName`, deployment id, default model, thinking level.
- Brain: preset, custom name, custom soul prompt, launch brief, and enabled gbrain/gstack features.
- Skills: built-in gskills, Cloudflare MCP, default-pending executor MCP, files, memory, tasks, and semantic recall.
- Safety: MCP policy can be `auto`, `ask-every-time`, or `allow-all`.
- Execution: Agents SDK is the chat/state/orchestration runtime. Executor is the default execution-plane contract and becomes callable when `OPEN_THINK_EXECUTOR_MCP_URL` points at an MCP endpoint.
- Executor target: the default OpenThink target is a same-account Cloudflare Sandbox bridge backed by Containers; it may also point to a self-hosted Executor service.
- Sub-agents: each child can set purpose, mode, brain, skills, system prompt, and model. Built-in templates cover research scout, builder, reviewer, and Cloud operator workstreams.

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
- `/personal-agent/setup`
- `/runtime/context`

Raw Worker fallback deployments expose the same hosted-agent discovery and sub-agent control endpoints, with chat over SSE/JSON instead of Agents SDK WebSocket chat.
