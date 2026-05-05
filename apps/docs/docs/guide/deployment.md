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

## Personal agent brain/stack setup

The self-service setup form includes a Personal agent section. It defaults to `OpenThink gbrain + gstack`, a Cloudflare-native profile that uses D1 memory, R2 files, Queue tasks, Vectorize semantic recall, MCP tools, and runtime setup state.

Users can instead choose researched presets for AIBrain, CoPaw, MemMachine, Mem0, Zep/Graphiti, Thoth, Hivemind, MemForge/A-MEM, or a custom `.brain` profile. Advanced mode lets the owner turn individual features on or off, including profile memory, episodic memory, semantic recall, knowledge graph, MCP bridge, task queue, file workspace, proactive routines, browser automation, multi-agent support, local-first routing, and health tracking.

The setup also includes an MCP tool approval policy. The default is `auto`: read/search/status-style MCP tools can run directly, while writes, deletes, deploys, billing, secrets, tokens, Access, DNS, Worker, D1, R2, Queue, Vectorize, and unknown Cloudflare operations require owner approval. Owners can instead choose `ask-every-time` to approve every MCP tool call or `allow-all` to run MCP tools without approval prompts. The selected policy is stored in public personal-agent config and as the `OPEN_THINK_TOOL_APPROVAL_POLICY` Worker variable so deployment settings or factory reset can change it later without rotating secrets.

The `.brain`/soul prompt and the launch brief are separate inputs. The soul prompt is durable identity and operating policy. The launch brief is initial mission context, active work, or first goals for the spawned agent. Public runtime config only records whether each value is configured.

When a personal-agent profile is enabled, provisioning runs the setup bootstrap against the agent D1 database:

- Creates `personal_agent_setup`.
- Creates `personal_agent_feature_flags`.
- Ensures the `memories` table exists.
- Stores the selected brain/stack profile, feature toggles, setup kind, setup status, and setup steps.
- Persists each advanced feature toggle as a first-class feature flag row.
- Seeds a setup memory row so the first chat has durable context.
- Seeds a separate launch-brief memory row when the owner provides initial mission context.
- Queues a one-time `personal-agent-setup` task when the deployed runtime first sees a new setup record and `TASK_QUEUE` is bound.
- Uploads `OPEN_THINK_PERSONAL_AGENT_CONFIG` as a plaintext Worker binding with public profile metadata.
- Uploads `OPEN_THINK_SOUL_PROMPT` as a Worker secret when the owner provides a custom `.brain`/soul prompt.
- Uploads `OPEN_THINK_LAUNCH_BRIEF` as a separate Worker secret when the owner provides an initial launch brief.

The generated runtime also self-heals this bootstrap from `/health`, `/manifest`, `/runtime/context`, `/personal-agent/setup`, and `/chat`, so a restored Worker recreates the setup row if it is missing. External presets are marked `external-runtime-needed` until the owner provides the workstation, MCP endpoint, or external memory server credentials; the agent must not claim those external systems are connected until that follow-up is complete.

During reset, source restore preserves the current personal-agent brain/stack profile. Factory reset clears the profile by default, but the reset UI can re-setup a new brain/stack in the same operation. When re-setup is enabled, the reset upload writes the new public config, stores any new soul prompt or launch brief as Worker secrets, and runs the personal-agent setup SQL again when the deployment D1 database is known.

## Deployed personal agent UI

The deployed user-owned Worker serves the personal agent app at `/`. The first screen is the agent workspace, not a JSON manifest. It includes chat, runtime binding status, D1 memory, R2 file writes, Queue task submission, terminal handoff, Cloudflare control-plane status, and an advanced MCP control panel.

The MCP panel exposes:

- Built-in Cloudflare MCP-compatible tools: `search` and `execute`.
- A server registry stored in the agent's D1 binding.
- Tool discovery through `/mcp/tools`.
- Tool calls through `/mcp/call`.

The built-in Cloudflare bridge uses the deployed Worker's `OPEN_THINK_CF_API_TOKEN` secret and `OPEN_THINK_CF_ACCOUNT_ID` variable. Generic external MCP servers use Streamable HTTP JSON-RPC. OAuth-backed MCP connections are represented in the UI and should move to the Cloudflare Agents SDK `addMcpServer()` flow when the generated deployment path is upgraded from raw Worker upload to bundled Agents SDK deployment.

## Agents SDK runtime

Generated personal-agent deployments default to the package-style Cloudflare Agents SDK runtime. This is the path that handles chat streaming through `AIChatAgent`, not a hand-rolled streaming protocol:

- `starters/personal-agent/src/agents-sdk.ts` exports `PersonalChatAgent extends AIChatAgent`.
- `starters/personal-agent/wrangler.agents-sdk.jsonc` binds `PersonalChatAgent` as a SQLite Durable Object.
- `apps/platform/src/lib/agents-sdk-runtime-template.ts` renders the same project layout for generated deployments.
- `src/client.tsx` uses `useAgent()` and `useAgentChat()` from the official SDK packages.
- `OPEN_THINK_RUNTIME_BUILD_ENDPOINT` points at an optional build service that installs dependencies, bundles the generated project, and uploads it to Cloudflare. Local Node deployments can build the generated Agents SDK runtime with the checked-in `starters/personal-agent` toolchain instead.

The Agents SDK runtime uses:

- `routeAgentRequest()` for `/agents/personal-chat-agent/<instance>` routing.
- `AIChatAgent` and `toUIMessageStreamResponse()` for resumable WebSocket chat streaming and SQLite message persistence.
- `addMcpServer()` and `this.mcp.getAITools()` for native MCP client connections.
- `getUserTimezone` as a browser-side tool, `confirmCloudflareOperation` as a human approval checkpoint, and `OPEN_THINK_TOOL_APPROVAL_POLICY` to wrap MCP tools with `auto`, `ask-every-time`, or `allow-all` approval behavior.
- Workers Assets for the deployed React chat client.
- A `/mcp/add` Agent sub-route for adding remote MCP servers and `/mcp/state` for inspecting registered servers.

If `OPEN_THINK_RUNTIME_BUILD_ENDPOINT` is missing in a local Node environment, provisioning uses `agents-sdk-local-build`: it renders the generated runtime, runs the starter Vite/Wrangler dry-run build, uploads static assets through the Workers assets upload API, and then uploads the bundled Worker module. Hosted platforms without a local build toolchain should configure `OPEN_THINK_RUNTIME_BUILD_ENDPOINT`. To intentionally use the fallback, set `OPEN_THINK_GENERATED_RUNTIME=raw-worker-module`; that runtime streams response chunks over SSE at `/chat?stream=1` and is kept for local/debug escape hatches only.

Client surfaces use `useAgent()` from `agents/react` plus `useAgentChat()` from `@cloudflare/ai-chat/react` so the Agents SDK owns WebSocket connection state, resumable UI-message streaming, persisted history, tool approvals, client-side tool outputs, and clear-history behavior.

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
