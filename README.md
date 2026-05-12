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
- `/personal-agent/setup` and `/runtime/context` for customization/readiness metadata.
- Executor is the default execution-plane contract. `OPEN_THINK_EXECUTOR_MCP_URL` points to an MCP endpoint, usually an OpenThink Sandbox bridge backed by Cloudflare Containers, not directly to a raw container.

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

`deploy:cf` creates or reuses the platform D1/R2/Queue/Vectorize resources, applies the D1 schema, writes `apps/platform/wrangler.generated.jsonc`, builds with the Cloudflare OpenNext adapter, and deploys the Worker.

Public users launch agents from the deployed site with their own scoped Cloudflare API token. If the token can see exactly one account, the platform infers the Cloudflare account id automatically; otherwise the user enters the target account id. The deploy form includes a Cloudflare Dashboard token-creation button preloaded with the required Workers, D1, R2, Queues, Vectorize, Workers AI, Account Settings, User Details, and Access Apps and Policies permissions. The platform stores deployment metadata and a token fingerprint, not the raw user token. The user-owned deployed Worker receives the token as `OPEN_THINK_CF_API_TOKEN` secret so the personal agent can operate Cloudflare APIs/MCP after launch.

Self-service launches enable the deployed Worker's `workers.dev` route, resolve the real `https://<script>.<account-subdomain>.workers.dev` URL, and create a Cloudflare Access self-hosted application with an email allow policy for the owner. If the Access application cannot be created, provisioning disables the route again and fails the launch instead of leaving the Worker public.

Local `next dev` can launch agents with in-memory platform state. For persistent local launch records against real Cloudflare D1, run `pnpm --filter @open-think/platform provision:cf` first. That provisions the platform D1 database and writes `OPEN_THINK_PLATFORM_D1_DATABASE_ID` to `apps/platform/.env.local`; keep `CLOUDFLARE_API_TOKEN` available as an environment variable or ignored local env value, then restart `pnpm dev`.

## Sync Model

Deployed personal agents use GitHub as the upstream update channel by default. The platform checks `OPEN_THINK_UPDATE_REPOSITORY` and `OPEN_THINK_UPDATE_BRANCH`, regenerates the Worker from the current platform runtime, and uploads it through the Cloudflare Workers Scripts API with secret preservation enabled.

Cloudflare Artifacts Git is optional and can be added after the initial launch. Free/basic accounts can stay on the GitHub upstream update lane. Paid accounts can enable the self-edit workspace later, which creates a per-agent Artifacts repo, stores the repo-scoped Artifacts token as a Worker secret, and marks Sandbox/Containers as ready-to-add for tests, command execution, previews, and agent-authored code changes.

Artifacts sync deploys fail closed unless `ARTIFACTS_REMOTE`, `ARTIFACTS_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `OPEN_THINK_SCRIPT_NAME` are configured.

Deployed personal agents use `OPEN_THINK_UPDATE_REPOSITORY=NeoFlux-Holdings/OpenThink` by default for upstream remote-update checks.

The `/sync` update panel also includes a guarded reset path. Source restore reuploads the generated Worker from GitHub while preserving workspace metadata and encrypted Worker secrets. Factory reset requires typing `RESET <deployment-id>` and also disables auto updates, removes workspace metadata and custom non-secret Worker bindings, restores the Kimi K2.6 Workers AI defaults, and preserves encrypted Worker secrets.

Future contribution flow: an agent-owned draft workspace can keep user-specific artifacts separately, then open a branch and pull request against `NeoFlux-Holdings/OpenThink` through GitHub when the owner wants to contribute a reusable change upstream.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```
