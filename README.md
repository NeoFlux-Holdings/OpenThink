# OpenThink

`open-think` is a Cloudflare-native Personal Agent OS. The v3 platform is organized around a Worker entrypoint, Durable Object coordination, and Container-backed execution, with first-class deployment, chat, and terminal control surfaces.

Public source: [NeoFlux-Holdings/OpenThink](https://github.com/NeoFlux-Holdings/OpenThink)

## What is included

- `apps/platform`: Next.js platform shell for deployment flows, chat, terminal, and API adapters.
- `apps/docs`: VitePress documentation site.
- `packages/*`: swappable runtime contracts for state, LLMs, memory, retrieval, storage, tasks, networking, sandboxing, MCP, terminal, and UI hooks.
- `starters/personal-agent`: the single all-in-one starter for chat, coding, messaging-style workflows, files, memory, tasks, terminal handoff, and MCP tools.
- `tools`: internal utilities for generating Cloudflare deployment manifests.

## Hosted Agent SDK

Deployed personal agents expose a hosted Cloud Agent surface in addition to the chat UI:

- `/health`, `/manifest`, and `/cloud-agent/profile` for discovery.
- `/goal` for active objective setup.
- `/subagents` and `/subagents/{id}/messages|control|summary` for delegated Cloud Agent Instance children.
- `/workspace` for the auto-spun Workspace Orchestrator and durable workspace context.
- `/skills`, `/memory`, `/artifacts`, `/files`, `/tasks`, `/browser/snapshot`, `/browser/diagnostics`, `/browser/sessions`, `/contributions`, `/learning`, `/executor`, `/mcp/servers`, `/mcp/state`, `/mcp/add`, `/mcp/tools`, `/mcp/call`, and `/mcp/observability` for SDK-backed capability discovery, artifact/library previews, file workspace state, task queue tracking, Browser Run snapshot/live-session artifacts with same-origin target frame streams, credential/API/live-frame diagnostics, `.diff`/`.patch` review artifacts rendered with `@pierre/diffs`, captured Sandbox diff artifacts that can feed owner-approved upstream PRs, train-mode readiness, executor status, MCP bridge integration, and recent tool/RPC activity.
- The deployed composer exposes `Auto`, `Plan first`, and `Train` modes. `Train` maps to `/train`, drafts an editable plan before mutating work, and feeds successful patterns back into the learning/skills lane.
- The deployed starter uses a Persona-style shell: left workspace navigation, center conversation feed, command-palette search (`Ctrl+K`), and a right artifact canvas with library, learning, skills, executor, runtime, and sub-agent controls.
- `/personal-agent/setup` and `/runtime/context` for customization/readiness metadata.
- Package-style personal agents back D1-tracked sub-agent records with native `OpenThinkSubAgent` children, so UI/SDK controls and chat tools share the same sub-agent RPC path.
- Executor is the default execution-plane contract. Generated Agents SDK deployments include a same-Worker Cloudflare Sandbox/Containers RPC bridge and expose `sandbox_*` executor tools, including `sandbox_diff` for reviewable Git patch artifacts; `OPEN_THINK_EXECUTOR_MCP_URL` is optional for an external MCP endpoint.
- Cloudflare API MCP defaults to Code Mode with the compact `search`/`execute` tool shape.
- Tool approval policies are `auto`, `ask-every-time`, `allow-all`, and `full-auto`.

External apps can use `@open-think/core`:

```ts
import { createHostedCloudAgentClient } from "@open-think/core";

const agent = createHostedCloudAgentClient({
  baseUrl: "https://your-agent.workers.dev"
});

await agent.goal("Ship a hosted workflow");
const child = await agent.createSubAgent({
  name: "Scout",
  purpose: "Inspect deploy readiness",
  mode: "hybrid"
});
await agent.sendSubAgentMessage(child.subAgent.id, "Continue.");
const workspace = await agent.workspace();
await agent.addMemory("Prefer concise deploy-readiness briefs.");
const learning = await agent.learning();
if (learning.suggestions?.items[0]) {
  await agent.acceptLearningSuggestion(learning.suggestions.items[0].id);
}
const artifacts = await agent.listArtifacts();
const snapshot = await agent.browserSnapshot({
  url: "https://developers.cloudflare.com/agents/"
});
const browser = await agent.createBrowserSession({
  url: "https://developers.cloudflare.com/browser-run/",
  targets: true
});
const contribution = await agent.contributions();
const executor = await agent.executorStatus();
```

## Run locally

```bash
pnpm install
pnpm dev
```

The platform app starts on `http://localhost:3000`.

## Deploy to Cloudflare

Configure `.env` or Worker secrets from `.env.example`, then run:

```bash
pnpm --filter @open-think/platform deploy:cf
```

`deploy:cf` creates or reuses the platform D1/R2/Queue/Vectorize resources, applies the D1 schema, writes `apps/platform/wrangler.generated.jsonc`, builds with the Cloudflare OpenNext adapter, and deploys the Worker. User-agent launches use the platform D1 record plus the `open-think-deployments` Cloudflare Queue when that binding is present, so a long Worker upload can continue after the deploy tab is closed or refreshed.

Public users launch agents from the deployed site with their own scoped Cloudflare API token. If the token can see exactly one account, the platform infers the Cloudflare account id automatically; otherwise the user enters the target account id. The deploy form includes a Cloudflare Dashboard token-creation button preloaded with the required Workers, D1, R2, Queues, Vectorize, Workers AI, Browser Rendering, Registrar, Account Settings, User Details, and Access Apps and Policies permissions. The platform stores deployment metadata and a token fingerprint, not the raw user token. The user-owned deployed Worker receives the token as `OPEN_THINK_CF_API_TOKEN` secret so the personal agent can operate Cloudflare APIs/MCP, capture Browser Run snapshots, and open live Browser Run sessions after launch.

The deploy form can also check Cloudflare Registrar beta availability and pricing for a new domain through `/api/deployment/domain-check`. If the user chooses an available domain, `/api/deployment/domain-register` re-checks the latest Registrar result, enforces a maximum price, and requires typing `REGISTER <domain>` before submitting the billable registration with `Prefer: respond-async`. The launch UI then polls `/api/deployment/domain-status` so the user sees the registration workflow state without copying internal Cloudflare API paths. Stripe Projects remains the future zero-touch path for creating a new Cloudflare account and billing profile.

Self-service launches enable the deployed Worker's `workers.dev` route, resolve the real `https://<script>.<account-subdomain>.workers.dev` URL, and create Cloudflare Access self-hosted applications with email allow policies for the owner. When a custom hostname is attached, Access is created for both the `workers.dev` hostname and the custom hostname so the protected Worker cannot be bypassed through either route. If Access setup fails, provisioning disables `workers.dev`, removes any just-created custom route/DNS record, and fails the launch instead of leaving the Worker public.

Local `next dev` can launch agents with in-memory platform state. For persistent local launch records against real Cloudflare D1, run `pnpm --filter @open-think/platform provision:cf` first. That provisions the platform D1 database and writes `OPEN_THINK_PLATFORM_D1_DATABASE_ID` to `apps/platform/.env.local`; keep `CLOUDFLARE_API_TOKEN` available as an environment variable or ignored local env value, then restart `pnpm dev`.

## Sync Model

Deployed personal agents use GitHub as the upstream update channel by default. The platform checks `OPEN_THINK_UPDATE_REPOSITORY` and `OPEN_THINK_UPDATE_BRANCH`, regenerates the Worker from the current platform runtime, and uploads it through the Cloudflare Workers Scripts API with secret preservation enabled.

Cloudflare Artifacts Git is optional and can be added after the initial launch. Free/basic accounts can stay on the GitHub upstream update lane. Paid accounts can enable the self-edit workspace later, which creates a per-agent Artifacts repo, stores the repo-scoped Artifacts token as a Worker secret, and marks Sandbox/Containers as ready-to-add for tests, command execution, previews, and agent-authored code changes.

Artifacts sync deploys fail closed unless `ARTIFACTS_REMOTE`, `ARTIFACTS_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `OPEN_THINK_SCRIPT_NAME` are configured.

Deployed personal agents use `OPEN_THINK_UPDATE_REPOSITORY=NeoFlux-Holdings/OpenThink` by default for upstream remote-update checks.

The `/sync` update panel also includes a guarded reset path. Source restore reuploads the generated Worker from GitHub while preserving workspace metadata and encrypted Worker secrets. Factory reset requires typing `RESET <deployment-id>` and also disables auto updates, removes workspace metadata and custom non-secret Worker bindings, restores the Kimi K2.6 Workers AI defaults, and preserves encrypted Worker secrets.

Contribution flow: agents can keep user-specific artifacts in R2, then use `/contributions` or `agent.createContributionPullRequest()` to open a branch and pull request against `NeoFlux-Holdings/OpenThink` through GitHub when the owner wants to contribute a reusable change upstream. The endpoint accepts explicit file changes or `artifactKeys`; `OPEN_THINK_GITHUB_TOKEN` is required and commits use OpenThink attribution only.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```
