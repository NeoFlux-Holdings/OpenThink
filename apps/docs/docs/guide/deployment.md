# Deployment

The platform app exposes a unified deployment engine. Each route adapts its protocol-specific payload into a shared `DeploymentRequest`:

- `/api/deployment/stripe`
- `/api/deployment/self`
- `/api/deployment/button`
- `/api/deployment/agent`
- `/api/deployment/partner`

The engine emits Server-Sent Events so the browser can display progress while account, binding, Worker, Container, and agent URL stages complete.

## Live automation

`DEPLOYMENT_MODE=cloudflare-api` is the only supported deployment mode. For public self-service launches, the user supplies their own Cloudflare account id and scoped API token in the deployment flow. Platform-owner credentials are reserved for deploying the platform itself and for formally approved partner flows.

The deploy UI shows the active mode, provisioner, state repository, model provider, and the planned resource names for:

- Worker script
- Cloudflare Access application
- D1 database
- R2 bucket
- Vectorize index
- Queue
- Agent Container class

## State persistence

Deployment records are stored in the `DB` D1 binding. If the binding is absent, deployment APIs return a configuration error instead of reporting success.

## Public self-service launch

The primary public route is `/api/deployment/self`. It deploys one all-in-one `personal-agent` template for coding, chat, messaging-style workflows, memory, files, tasks, and terminal handoff.

Required request fields:

- `cfApiToken`
- `accessAllowedEmail`
- `agentName`
- `spendLimitUsd`, capped at `$100`
- `acceptedTerms`

`cloudflareAccountId` is optional when the token can see exactly one Cloudflare account. The platform calls the Cloudflare accounts API to infer that account before provisioning. If the token can access multiple accounts, the user must enter the target account id.

The raw Cloudflare API token is used for live Cloudflare API calls during provisioning and is attached to the deployed user-owned Worker as the `OPEN_THINK_CF_API_TOKEN` secret so the personal agent can continue operating Cloudflare through API or MCP workflows. The platform stores deployment metadata, the user-owned account id, the configured spend guardrail, and a token fingerprint; it does not store the raw token in platform D1.

The deployed Worker also receives `OPEN_THINK_CF_ACCOUNT_ID` as a plaintext runtime variable. This value is not sensitive by itself, but the runtime API token is a secret binding and should only be scoped to the account/actions the user wants the personal agent to perform.

Provisioning enables the deployed Worker's `workers.dev` route, resolves the account's real Workers subdomain, and returns `https://<script>.<account-subdomain>.workers.dev` as the agent URL. The same provisioning run creates a Cloudflare Access self-hosted application for that hostname and an allow policy for `accessAllowedEmail`. If Access setup fails, the provisioner disables the `workers.dev` route again and fails closed.

Administrators can inspect recent launch records through `/api/admin/deployments`. Configure `OPEN_THINK_ADMIN_EMAILS` with comma-separated Cloudflare Access or JWT user emails in production. Local development can set `OPEN_THINK_DEV_ADMIN=true`.

## Deployed personal agent UI

The deployed user-owned Worker serves the personal agent app at `/`. The first screen is the agent workspace, not a JSON manifest. It includes chat, runtime binding status, D1 memory, R2 file writes, Queue task submission, terminal handoff, Cloudflare control-plane status, and an advanced MCP control panel.

The MCP panel exposes:

- Built-in Cloudflare MCP-compatible tools: `search` and `execute`.
- A server registry stored in the agent's D1 binding.
- Tool discovery through `/mcp/tools`.
- Tool calls through `/mcp/call`.

The built-in Cloudflare bridge uses the deployed Worker's `OPEN_THINK_CF_API_TOKEN` secret and `OPEN_THINK_CF_ACCOUNT_ID` variable. Generic external MCP servers use Streamable HTTP JSON-RPC. OAuth-backed MCP connections are represented in the UI and should move to the Cloudflare Agents SDK `addMcpServer()` flow when the generated deployment path is upgraded from raw Worker upload to bundled Agents SDK deployment.

## Experimental Agents SDK runtime

The current public deployment path still uploads a raw generated Worker module through the Workers Scripts multipart API. That path cannot directly consume npm-only runtime imports such as `@cloudflare/ai-chat`, `agents`, `ai`, or `workers-ai-provider` without adding a bundling step.

An experimental package-style runtime is available for the next deployment path:

- `starters/personal-agent/src/agents-sdk.ts` exports `PersonalChatAgent extends AIChatAgent`.
- `starters/personal-agent/wrangler.agents-sdk.jsonc` binds `PersonalChatAgent` as a SQLite Durable Object.
- `apps/platform/src/lib/agents-sdk-runtime-template.ts` renders the same project layout for generated deployments.

The experimental runtime uses:

- `routeAgentRequest()` for `/agents/personal-chat-agent/<instance>` routing.
- `AIChatAgent` and `toUIMessageStreamResponse()` for resumable WebSocket chat streaming and SQLite message persistence.
- `addMcpServer()` and `this.mcp.getAITools()` for native MCP client connections.
- A `/mcp/add` Agent sub-route for adding remote MCP servers and `/mcp/state` for inspecting registered servers.

To make this the default generated runtime, the provisioner needs a bundled Worker upload path, for example a temporary generated project plus `wrangler deploy`/`wrangler versions upload`, or an equivalent bundler step that resolves npm dependencies before calling the Workers Scripts API. After that, the deployed UI can move from POST `/chat` to the Agents SDK client protocol with `useAgent` and `useAgentChat`.

## Token automation options

The public flow cannot silently create a scoped Cloudflare token for a user. Cloudflare requires either an OAuth consent grant, a partner/account-provisioning agreement, or an existing token with token-creation permissions.

Preferred production path:

- Register a Cloudflare OAuth application.
- Request only the account permissions needed for Workers, D1, R2, Queues, Vectorize, Workers AI, and Access.
- Let the user choose the account during Cloudflare consent.
- Store the OAuth grant or derived deployment credential according to Cloudflare's token handling rules.

Fallback path:

- Send the user through the deploy form's `Create scoped token` button. It opens Cloudflare Dashboard with the account id, token name, and required permission groups prefilled.
- Verify the token before deployment.
- Use it for provisioning only.
- Store only a fingerprint.

Advanced bootstrap path:

- A user can create an initial token from Cloudflare's `Create additional tokens` template.
- The platform can use that bootstrap token to call Cloudflare's token creation API and mint a narrower deployment token.
- This should not be the default public flow because the bootstrap token can create additional tokens across the user's resources.

## Cloudflare deploy

Build and deploy the platform Worker with the Cloudflare OpenNext adapter:

```bash
pnpm --filter @open-think/platform deploy:cf
```

`deploy:cf` runs `provision:cf` first. That script creates or reuses the platform D1, R2, Queue, and Vectorize resources, applies the D1 schema through the D1 query API, and writes `wrangler.generated.jsonc` with the real resource ids before OpenNext builds and deploys.

The deployment engine provisions each user agent's D1, R2, Queue, Vectorize, Worker script, `workers.dev` route, and Access application through Cloudflare account APIs, applies the D1 schema through the D1 query API, and uploads the generated agent module through the Workers Scripts multipart upload API.

## Local launches against Cloudflare

`next dev` does not provide Worker bindings, so it cannot see `env.DB` directly. Local development can launch agents with in-memory platform state, but those records disappear when the dev server restarts.

To test real user-agent launches locally with persistent platform records, run:

```bash
pnpm --filter @open-think/platform provision:cf
pnpm dev
```

`provision:cf` creates the platform D1 database, applies the schema, writes `wrangler.generated.jsonc`, and records `OPEN_THINK_PLATFORM_D1_DATABASE_ID` in ignored `apps/platform/.env.local`. With `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `OPEN_THINK_PLATFORM_D1_DATABASE_ID` available, local API routes use Cloudflare's D1 REST query API for real platform persistence instead of requiring a Worker `DB` binding. Production deployments still require a D1 binding or the remote D1 configuration.

## Repository propagation

The first deployment can be bootstrapped from this monorepo, but runtime propagation should use the Artifacts sync loop:

`local repo -> Cloudflare Artifacts -> Worker`

and for agent-generated changes:

`Worker draft -> Cloudflare Artifacts -> local pull`

The `/sync` workbench exposes manual pull, commit, push, deploy, and reconcile actions. The Worker cron can run the same reconciler automatically.
