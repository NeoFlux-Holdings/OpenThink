# Deployment

The platform app exposes a unified deployment engine. Each route adapts its protocol-specific payload into a shared `DeploymentRequest`:

- `/api/deployment/stripe` (reserved; returns `501` until official Stripe Projects orchestration is connected)
- `/api/deployment/self`
- `/api/deployment/button`
- `/api/deployment/agent`
- `/api/deployment/partner`

The engine emits Server-Sent Events so the browser can display progress while account, binding, Worker, Container, and agent URL stages complete. In deployed Cloudflare mode, the initial request creates a D1 deployment record, sends a durable `DEPLOYMENT_QUEUE` job, and then the browser follows `/api/deployment/status/{deploymentId}` if the SSE response closes before the Worker upload is finished. Closing or refreshing the browser does not cancel the queued provisioning run.

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

When the platform Worker has the `DEPLOYMENT_QUEUE` binding and persistent D1 state, self-service launches run through the queue consumer instead of relying on the open HTTP request to finish. The queue message carries the transient deployment request, including the user-supplied Cloudflare token, inside Cloudflare's internal Queue; the platform D1 record stores only the deployment metadata and token fingerprint.

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

The deploy form also includes a Cloudflare Registrar availability check for users who need a new domain. It calls `/api/deployment/domain-check`, which uses the user-supplied token against the official Registrar beta `domain-search` and `domain-check` endpoints. Available domains expose a guarded registration panel: `/api/deployment/domain-register` re-checks the exact domain, blocks premium/unpriced/unavailable results, enforces the user's maximum price and quoted currency, and requires typing `REGISTER <domain>` before sending the billable Registrar registration request with `Prefer: respond-async`. After submission, the UI polls `/api/deployment/domain-status` and displays the Registrar workflow state until the platform sees a terminal status. Stripe Projects remains the future zero-touch path for creating a new Cloudflare account and billing profile.

Provisioning enables the deployed Worker's `workers.dev` route, resolves the account's real Workers subdomain, and returns `https://<script>.<account-subdomain>.workers.dev` as the agent URL. The same provisioning run creates Cloudflare Access self-hosted applications for the `workers.dev` hostname and, when configured, the custom hostname. Each app gets an allow policy for `accessAllowedEmail` plus optional additional emails. If Access setup fails, the provisioner disables `workers.dev`, deletes any just-created custom route or DNS record, and fails closed.

Administrators can inspect recent launch records through `/api/admin/deployments`. Configure `OPEN_THINK_ADMIN_EMAILS` with comma-separated Cloudflare Access or JWT user emails in production. Local development can set `OPEN_THINK_DEV_ADMIN=true`.

## Personal agent brain/stack setup

The self-service setup form includes a Personal agent section. It defaults to `OpenThink gbrain + gstack`, a Cloudflare-native profile that uses D1 memory, R2 files, Queue tasks, Vectorize semantic recall, MCP tools, and runtime setup state.

Users can instead choose researched presets for AIBrain, CoPaw, MemMachine, Mem0, Zep/Graphiti, Thoth, Hivemind, MemForge/A-MEM, or a custom `.brain` profile. Advanced mode lets the owner turn individual features on or off, including profile memory, episodic memory, semantic recall, knowledge graph, MCP bridge, task queue, file workspace, proactive routines, browser automation, multi-agent support, local-first routing, and health tracking.

The setup also includes an MCP tool approval policy. The default is `auto`: read/search/status-style tools and low-risk goal-scoped Code Mode execution can run directly, while destructive, spend, secret, identity, Access, DNS, route, or account-level changes still require owner approval. Owners can instead choose `ask-every-time`, `allow-all`, or `full-auto`. `allow-all` is kept as a legacy alias for full automatic approval: MCP tools and built-in approval checkpoints run without prompts. The selected policy is stored in public personal-agent config and as the `OPEN_THINK_TOOL_APPROVAL_POLICY` Worker variable so deployment settings or factory reset can change it later without rotating secrets.

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

The deployed user-owned Worker serves the personal agent app at `/`. The first screen is the agent workspace, not a JSON manifest. It includes chat, runtime binding status, D1 memory, R2 artifact/library status, Queue task submission, terminal handoff, Cloudflare control-plane status, hosted SDK snippets, a workspace canvas for `/skills`, `/learning`, `/artifacts`, `/executor`, and `/mcp/servers`, and a sub-agent console.

The generated chat runtime supports `/goal`. Sending `/goal <objective>` asks the personal agent to turn that objective into an active goal brief with success criteria, milestones, next actions, risks, and a resume prompt. Sending `/goal` with no text asks the agent to review active goals from conversation and memory, then request the missing objective only if needed. The runtime also exposes `/goal` as a lightweight JSON capability endpoint.

Each generated runtime also exposes a cloud agent instance profile in `/health`, `/manifest`, `/runtime/context`, and the `/goal` capability payload. That profile is the durable contract for chat runtime, brain preset, gskills, custom prompts, and execution planes. Cloudflare Agents SDK remains the primary runtime for chat streaming, resumable state, SQLite persistence, MCP orchestration, and human approvals. Executor is the default execution-plane contract. Generated Agents SDK deployments include a same-Worker Cloudflare Sandbox Durable Object, a Containers image, `SANDBOX_TRANSPORT=rpc`, built-in `sandbox_*` chat tools, and `/mcp/tools?server=executor` plus `/mcp/call` for SDK discovery. `OPEN_THINK_EXECUTOR_MCP_URL` is now optional and is used only when you want a separate self-hosted or executor.sh-compatible MCP endpoint; set `OPEN_THINK_EXECUTOR_AUTH_TOKEN` for bearer auth on that external endpoint.

The generated runtime also exposes `/workspace`, `/skills`, `/memory`, `/artifacts`, `/learning`, `/learning/{id}`, `/executor`, `/mcp/servers`, `/mcp/state`, `/mcp/add`, `/mcp/tools`, `/mcp/call`, and `/mcp/observability`. `/artifacts` lists R2-backed artifacts, returns current text plus prior revisions with `GET /artifacts?key=...&versions=1`, and saves the previous object under an internal revision prefix whenever an artifact is overwritten. The starter canvas supports single/grid/stack views, version selection, document/code previews, table previews, pop-out viewing, and sandboxed HTML app previews. `/learning` returns train/teach readiness plus pending review items, accepts `POST` to create a learning suggestion, and accepts `PATCH /learning/{id}` or `DELETE /learning/{id}` to accept, edit, or reject suggestions from the starter UI and hosted SDK. `/mcp/observability` reads D1-backed recent MCP, executor, and workspace RPC activity with per-server call/failure counts and latency. The default workspace auto-spins a `WorkspaceOrchestrator` Cloudflare sub-agent, preloads Cloudflare skill sources from `cloudflare/skills`, `llms-full.txt`, the Agents docs, and Workers best practices, and stores decision-ready context in D1 `workspace_context`. When both `AI` and `VECTORIZE` bindings are present, memory and workspace context are embedded with Workers AI and indexed into Vectorize for semantic recall; if that path is unavailable, the runtime falls back to D1 text search.

The personal-agent UI includes a sub-agent console for scoped Cloud Agent Instance children. Sub-agents are tracked in D1 with their own purpose, brain, mode, system prompt, skills, status, summary, and message thread. In package-style Agents SDK deployments, those D1 records are backed by exported `OpenThinkSubAgent` child Agents: `/subagents` routes through the default `PersonalChatAgent` with `getAgentByName(..., { routingRetry })`, messages execute through `subAgent(OpenThinkSubAgent, id)` typed RPC, and child reports are written back into `workspace_context`. The runtime also exports `OpenThinkWorkspaceMcp`, binds it as `WORKSPACE_MCP`, and registers it with `addMcpServer("workspace-orchestrator", WORKSPACE_MCP)` so agent-to-agent workspace status, coordination, context recording, and sub-agent messages can flow over same-Worker MCP RPC without public HTTP.

The MCP panel exposes:

- Built-in Cloudflare MCP-compatible tools: `search` and `execute`.
- Executor tools through the same-Worker Sandbox/Containers bridge, or an optional external executor MCP endpoint when `OPEN_THINK_EXECUTOR_MCP_URL` is configured.
- A server registry stored in the agent's D1 binding.
- Tool discovery through `/mcp/tools`.
- Tool calls through `/mcp/call`.
- D1-backed activity inspection through `/mcp/observability` and `/mcp/observability?series=1`, mirrored in the Workspace Canvas MCP activity panel.

The built-in Cloudflare bridge uses the deployed Worker's `OPEN_THINK_CF_API_TOKEN` secret and `OPEN_THINK_CF_ACCOUNT_ID` variable. The Cloudflare API MCP defaults to Code Mode at `https://mcp.cloudflare.com/mcp?codemode=search_and_execute`; set `OPEN_THINK_CLOUDFLARE_MCP_CODE_MODE=disabled` only to fall back to the non-Code-Mode URL. Generic external MCP servers use Streamable HTTP JSON-RPC. OAuth-backed MCP connections are represented in the UI and should move to the Cloudflare Agents SDK `addMcpServer()` flow when the generated deployment path is upgraded from raw Worker upload to bundled Agents SDK deployment.

## Agents SDK runtime

Generated personal-agent deployments default to the package-style Cloudflare Agents SDK runtime. This is the path that handles chat streaming through `AIChatAgent`, not a hand-rolled streaming protocol:

- `starters/personal-agent/src/agents-sdk.ts` exports `PersonalChatAgent extends AIChatAgent`.
- `starters/personal-agent/wrangler.agents-sdk.jsonc` binds `PersonalChatAgent` and `Sandbox` as SQLite Durable Objects, declares the `Sandbox` container image, and sets `SANDBOX_TRANSPORT=rpc`.
- `apps/platform/src/lib/agents-sdk-runtime-template.ts` renders the same project layout for generated deployments.
- `src/agents-sdk.ts` exports `Sandbox` from `@cloudflare/sandbox`, so existing Durable Object migrations keep the chat class and add the execution class without renaming either.
- `src/client.tsx` uses `useAgent()` and `useAgentChat()` from the official SDK packages.
- `OPEN_THINK_RUNTIME_BUILD_ENDPOINT` points at an optional build service that installs dependencies, bundles the generated project, and uploads it to Cloudflare. Local Node deployments can build the generated Agents SDK runtime with the checked-in `starters/personal-agent` toolchain instead.

The Agents SDK runtime uses:

- `routeAgentRequest()` for `/agents/personal-chat-agent/<instance>` routing.
- `AIChatAgent` and `toUIMessageStreamResponse()` for resumable WebSocket chat streaming and SQLite message persistence.
- `addMcpServer()` and `this.mcp.getAITools()` for native MCP client connections.
- `getUserTimezone` as a browser-side tool, `confirmCloudflareOperation` as a human approval checkpoint, and `OPEN_THINK_TOOL_APPROVAL_POLICY` to wrap MCP tools with `auto`, `ask-every-time`, `allow-all`, or `full-auto` approval behavior.
- `WorkspaceOrchestrator` as an auto-spun native sub-agent plus `coordinateWorkspace` and `/workspace` for durable workstream summaries outside the main chat transcript.
- `OpenThinkSubAgent` as the native-backed execution facet for D1-tracked specialist sub-agents, with top-down parent messages and bottom-up workspace reports.
- `OpenThinkWorkspaceMcp` as a same-Worker `McpAgent` server exposing `workspace_status`, `coordinate_workspace`, `record_workspace_context`, and `send_subagent_message` over Durable Object RPC.
- `sandbox_ping`, `sandbox_exec`, `sandbox_read_file`, `sandbox_write_file`, and `sandbox_list_files` as first-party executor tools. Read/list/ping are non-mutating; write/exec require approval unless the policy is `allow-all` or `full-auto`.
- Workers Assets for the deployed React chat client.
- A `/mcp/add` Agent sub-route for adding remote MCP servers and `/mcp/state` for inspecting registered servers.

If `OPEN_THINK_RUNTIME_BUILD_ENDPOINT` is missing in a local Node environment, provisioning uses `agents-sdk-local-build`: it renders the generated runtime, runs the starter Vite/Wrangler dry-run build, uploads static assets through the Workers assets upload API, and then uploads the bundled Worker module. Hosted platforms without a local build toolchain should configure `OPEN_THINK_RUNTIME_BUILD_ENDPOINT`. To intentionally use the fallback, set `OPEN_THINK_GENERATED_RUNTIME=raw-worker-module`; that runtime streams response chunks over SSE at `/chat?stream=1` and is kept for local/debug escape hatches only.

Client surfaces use `useAgent()` from `agents/react` plus `useAgentChat()` from `@cloudflare/ai-chat/react` so the Agents SDK owns WebSocket connection state, resumable UI-message streaming, persisted history, tool approvals, client-side tool outputs, and clear-history behavior. The generated client leaves server turns running across browser refreshes or temporary network drops, enables stream resume, and relies on server-side continuation after tool approvals/results.

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

`deploy:cf` runs `provision:cf` first. That script creates or reuses the platform D1, R2, Queue, and Vectorize resources, applies the D1 schema through the D1 query API, and writes `wrangler.generated.jsonc` with the real resource ids before OpenNext builds and deploys. The platform Worker declares both a producer and consumer for `open-think-deployments`, so long user-agent uploads continue from the queue even if the user leaves the deploy page.

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
