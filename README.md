# OpenThink

`open-think` is a Cloudflare-native Personal Agent OS. The v3 platform is organized around a Worker entrypoint, Durable Object coordination, and Container-backed execution, with first-class deployment, chat, and terminal control surfaces.

Public source: [NeoFlux-Holdings/OpenThink](https://github.com/NeoFlux-Holdings/OpenThink)

## What is included

- `apps/platform`: Next.js platform shell for deployment flows, chat, terminal, and API adapters.
- `apps/docs`: VitePress documentation site.
- `packages/*`: swappable runtime contracts for state, LLMs, memory, retrieval, storage, tasks, networking, sandboxing, MCP, terminal, and UI hooks.
- `starters/personal-agent`: the single all-in-one starter for chat, coding, messaging-style workflows, files, memory, tasks, terminal handoff, and MCP tools.
- `tools`: internal utilities for generating Cloudflare deployment manifests.

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

After bootstrap, `open-think` can use a Cloudflare Artifacts Git remote as the canonical repository. The platform exposes `/sync` for manual pull, commit, push, deploy, and reconcile actions, and the Worker cron can run the same reconciler automatically.

Sync deploys fail closed unless `ARTIFACTS_REMOTE`, `ARTIFACTS_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `OPEN_THINK_SCRIPT_NAME` are configured.

Deployed personal agents use `OPEN_THINK_UPDATE_REPOSITORY=NeoFlux-Holdings/OpenThink` by default for upstream remote-update checks.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```
