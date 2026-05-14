# Product Spec Audit

This checklist tracks the hosted personal-agent product spec against the current `NeoFlux-Holdings/OpenThink` implementation. It is intentionally conservative: a row is marked complete only when the repo has a concrete runtime surface, UI affordance, SDK method, deployment behavior, and validation coverage where appropriate.

| Requirement | Current evidence | Status |
|---|---|---|
| Use the current public/local repo | Git remote, update defaults, platform update-source helper, generated runtime fallbacks, and contribution defaults point at `NeoFlux-Holdings/OpenThink`; alternate implementation repos are not referenced, and the attribution/scope regression test guards this. | Complete |
| Do not attribute Claude to commits | No commit automation in this pass; generated docs and runtime copy avoid commit attribution. | Complete |
| Clean self-service onboarding | `/deploy` has scoped token help, fun default agent names, model/key setup, spend guardrail, personal-agent presets, domain options, and token verification. | Implemented |
| One-click token creation help | `buildOpenThinkTokenUrl` builds the prefilled Cloudflare token URL with Workers, D1, R2, Queues, Vectorize, Workers AI, AI Gateway, Browser Rendering, Pages, KV, Registrar, Access, Zone, DNS, Routes, account, and user permissions. | Implemented |
| Secure domain and Access setup | Deployment provisions workers.dev and optional custom-domain routes behind Cloudflare Access; custom-domain Access failure rolls back the route/DNS and fails closed. | Implemented |
| Setup/deploy progress tracking | Deployment records are created before Cloudflare provisioning, `/api/deployment/*` returns an SSE stream immediately after validation, Cloudflare mode enqueues the provisioning request into `DEPLOYMENT_QUEUE`, the Worker queue consumer continues long uploads after browser disconnects, progress callbacks persist D1/in-memory events while Cloudflare provisioning is still running, failed provisioners leave a durable failed record, the status API returns events, and the launch UI falls back to status polling plus active/complete/error timeline states and the final agent URL. | Implemented |
| Latest Agents SDK support | Starter and generated runtime use `agents@^0.12.4`, `@cloudflare/ai-chat@^0.7.0`, `@cloudflare/codemode@0.3.6`, `@cloudflare/shell@0.3.7`, `@cloudflare/think@0.6.1`, resumable chat, routing retries, durable `AIChatAgent` state, and non-blocking MCP/orchestrator warmup so slow MCP handshakes do not block WebSocket startup. | Complete |
| Code Mode MCP | Cloudflare API MCP defaults to `https://mcp.cloudflare.com/mcp?codemode=search_and_execute`; `OPEN_THINK_CLOUDFLARE_MCP_CODE_MODE=disabled` can turn it off. | Complete |
| Aggressive approval modes | Policies include `auto`, `ask-every-time`, `allow-all`, and `full-auto`; full auto suppresses built-in Cloudflare approval checkpoints and client-side "always allow tool" persists browser rules. | Complete |
| Executor support | Runtime advertises executor as the default execution-plane contract, exposes `sandbox_*` built-in chat tools including `sandbox_diff`, and serves executor discovery/calls through `/mcp/tools?server=executor` and `/mcp/call`; `OPEN_THINK_EXECUTOR_MCP_URL` remains available for optional external executor MCP endpoints. | Implemented |
| Public MCP, file, task, and artifact SDK contract | Package and raw runtimes expose `/mcp/servers`, `/mcp/state`, `/mcp/add`, `/mcp/tools`, `/mcp/call`, `/mcp/observability`, `/artifacts`, `/files`, `/tasks`, `/browser/snapshot`, `/browser/diagnostics`, and `/browser/sessions`; `@open-think/core` includes `mcpState()`, `mcpObservability()`, `addMcpServer()`, `agent.executor.*`, artifact helpers, file helpers, task helpers, `browserSnapshot()`, `browserDiagnostics()` / `agent.browser.diagnostics()`, and Browser Run session helpers. | Implemented |
| Sandbox and Containers | Starter and generated Agents SDK runtimes include `@cloudflare/sandbox@0.10.1`, export `Sandbox`, bind it as a SQLite Durable Object, declare the `Sandbox` container image, set `SANDBOX_TRANSPORT=rpc`, and provide human-readable command/file/diff tool results. | Implemented |
| Sub-agent top-down and bottom-up communication | D1 `sub_agents`/`sub_agent_messages`, UI controls, chat tools, native `OpenThinkSubAgent` child Agents, and workspace reports support parent-child communication. | Implemented |
| Same-Worker RPC pattern | Generated runtimes export `OpenThinkWorkspaceMcp`, bind it as `WORKSPACE_MCP`, register it with `addMcpServer("workspace-orchestrator", WORKSPACE_MCP)`, and expose workspace status, coordination, context recording, and sub-agent message tools over Durable Object RPC. | Implemented |
| Same-Worker MCP observability | Workspace MCP tools, executor discovery/calls, and direct `/mcp/call` results write D1 `mcp_observability` rows; `/mcp/observability`, `/mcp/observability?series=1`, and the Workspace Canvas MCP activity panel show per-server calls, failures, latency, recent event summaries, and per-minute export buckets. | Implemented |
| Workspace orchestrator | `WorkspaceOrchestrator` is auto-spun up, stores durable briefs in `workspace_context`, and can coordinate sub-agent state outside the chat transcript. | Implemented |
| Skills and catalog preload | Workspace defaults include Cloudflare Agents, Workers best practices, MCP Code Mode, Workflows, and `llms-full`; `/skills` exposes a `sourceCatalog` covering Cloudflare Skills, Cloudflare docs, `aihero.dev/skills.md`, `anthropics/skills`, and `openai/skills` while keeping non-Cloudflare catalogs opt-in by default. | Implemented |
| Vectorize shared memory | Vectorize binding/index is provisioned; Agents SDK runtime stores D1 memory/workspace context, indexes it into Vectorize with Workers AI when bindings are present, exposes `/memory?q=...`, and falls back to D1 text search when indexing/querying is unavailable. | Implemented |
| `/goal` | Runtime exposes `/goal`, `setActiveGoal`, D1 memory persistence, SDK method, UI copy, and docs. | Complete |
| Train mode | Composer exposes `Train`, drafts an editable objective/step plan, supports add/remove/reorder, approve-all, step-by-step approval, sends approved plans through `/train`, and instructs skill-save follow-up after successful runs. | Implemented |
| Persona shell | Starter now has left workspace navigation, center thread feed, right artifact canvas/runtime, grouped tool calls, markdown, sub-agent console, capability canvas, and run modes. | Implemented |
| Rich artifact system | `/artifacts` supports R2 list/get/put, prior-revision snapshots on overwrite, version selection, single/grid/stack canvas modes, document/code previews, table previews, sandboxed HTML app previews, image previews, slide deck controls, `@pierre/diffs` patch previews for `.diff`/`.patch` artifacts, browser-session artifacts from Cloudflare Browser Rendering `/snapshot`, `/browser/diagnostics` read-only and live Browser Run self-tests, Browser Run CDP session lifecycle endpoints with Live View takeover URLs, same-origin `/browser/sessions/{sessionId}/targets/{targetId}/frames/status?fps=4` diagnostics, same-origin `/browser/sessions/{sessionId}/targets/{targetId}/frames?fps=4` SSE screenshot streams when the target exposes a CDP websocket, inline Live View fallback, and pop-out artifact viewing. | Implemented |
| Learning system | `/learning` exposes train-mode readiness, pending memory/skill/rubric/workflow suggestions, D1-backed curation status, `POST /learning` creation, `PATCH /learning/{id}` accept/edit/reject updates, starter UI review actions, and SDK helpers for suggestion creation/curation. | Implemented |
| Search command palette | `Ctrl+K` opens a command palette across thread messages, artifacts, learning/memories, skills, runtime surfaces, and sub-agents. | Implemented |
| Update and reconcile | `/sync` and deployment update APIs support GitHub upstream status, deploy, reconcile, reset, auto-update metadata, and current repo default. | Implemented |
| Cloudflare Artifacts PR workflow | Agents SDK and raw runtimes expose `/contributions`; `@open-think/core` exposes `contributions()` and `createContributionPullRequest()`; the endpoint opens GitHub branches and pull requests against `NeoFlux-Holdings/OpenThink` from explicit file changes, R2 `artifactKeys`, or captured Sandbox `diffArtifactKeys`, records PR metadata in D1 when bound, and requires `OPEN_THINK_GITHUB_TOKEN`. Patch artifacts render inline with `@pierre/diffs`, and Agents SDK runtimes include `sandbox_diff` to capture Sandbox Git diffs into R2 `.diff` artifacts for review and PR creation. | Implemented |
| Existing-account domain purchase | The public deploy form checks Cloudflare Registrar beta availability/pricing through `/api/deployment/domain-check`; available domains expose a guarded `/api/deployment/domain-register` flow that re-checks the exact domain, blocks premium/unpriced/unavailable results, enforces a maximum price/currency guard, requires typing `REGISTER <domain>`, submits the billable Registrar request asynchronously, and tracks the workflow through `/api/deployment/domain-status`. | Implemented |
| Stripe Projects account onboarding | Existing Stripe deployment UI card is reserved as managed onboarding, and `/api/deployment/stripe` now fails closed with `501` until the official Stripe Projects orchestration is connected. Automatic Stripe Projects creation of a new Cloudflare account, billing profile, and domain purchase is not implemented end to end. Public launch copy avoids presenting account purchase as available. | Partial |
| Best-practice alignment | Docs and runtime instructions include Workers best practices, Access fail-closed behavior, scoped tokens, secret preservation, and no false claims about unavailable executor/sandbox planes. | Implemented |
| Validation | Tests, typechecks, platform build, starter build, docs build, and `git diff --check` pass for this iteration. | Complete |

## Current Validation Commands

```bash
pnpm test -- --runInBand
pnpm --filter @open-think/core typecheck
pnpm --filter @open-think/platform typecheck
pnpm --filter @open-think/starter-personal-agent typecheck
pnpm --filter @open-think/platform build
pnpm --filter @open-think/starter-personal-agent build
pnpm --filter @open-think/docs build
pnpm --dir packages/core pack --pack-destination $env:TEMP
git diff --check
```

## Completion Audit: 2026-05-14

The active objective is treated as these deliverables:

1. Keep the current `NeoFlux-Holdings/OpenThink` public/local repo as the canonical implementation and update source.
2. Provide secure, understandable self-service onboarding for a hosted Cloudflare personal agent.
3. Support Cloudflare token creation help, token verification, custom domain setup, Registrar checks/guarded registration, and Cloudflare Access fail-closed protection.
4. Run the latest verified Agents SDK chat stack with Code Mode MCP, aggressive approval modes, executor/Sandbox/Containers support, orchestrators, sub-agents, workspace MCP/RPC, and `/goal`/Train workflows.
5. Ship a Persona-style UI/UX/DEVX surface with thread feed, artifact canvas, library, learning, skills, sub-agent controls, update/reconcile, browser diagnostics, and SDK/discovery endpoints.
6. Keep contribution and update flows pointed at `NeoFlux-Holdings/OpenThink`, with no Claude commit attribution.
7. Validate platform, starter, core SDK, docs, tests, package packing, and diff hygiene.

Prompt-to-artifact checklist:

| Prompt requirement | Primary artifacts | Verification evidence | Audit result |
|---|---|---|---|
| Current repo only | `apps/platform/src/lib/update-source.ts`, `apps/platform/src/lib/__tests__/attribution.test.ts`, `README.md` | `git remote -v` points to `https://github.com/NeoFlux-Holdings/OpenThink.git`; runtime/update/contribution defaults point to `NeoFlux-Holdings/OpenThink`; regression tests assert the canonical repository and guard against alternate implementation repo references. | Complete |
| Current Cloudflare chat/runtime dependencies | `starters/personal-agent/package.json`, `pnpm-lock.yaml` | Registry checks on 2026-05-14 matched local pins: `agents` 0.12.4, `@cloudflare/ai-chat` 0.7.0, `@cloudflare/codemode` 0.3.6, `@cloudflare/think` 0.6.1, `@cloudflare/shell` 0.3.7, `@cloudflare/sandbox` 0.10.1, `@cloudflare/voice` 0.2.0, `@modelcontextprotocol/sdk` 1.29.0, `ai` 6.0.182, `@ai-sdk/react` 3.0.184, `workers-ai-provider` 3.1.14, `wrangler` 4.91.0, and `vite` 8.0.13. | Complete |
| Secure deploy/onboarding/token/domain/Access | `apps/platform/src/app/deploy/_components/SelfDeployFlow.tsx`, `apps/platform/src/lib/cloudflare-token-url.ts`, `apps/platform/src/lib/cloudflare-api.ts`, `apps/platform/src/lib/deployment-engine.ts`, `apps/platform/src/app/api/deployment/domain-*` | Unit tests cover token URL construction, token/account inference, domain availability/registration/status, custom-domain route/DNS setup, Access application reuse, malformed email rejection, queue-backed deployment, and failed-state persistence. | Implemented |
| Stripe managed account path | `apps/platform/src/app/api/deployment/stripe/route.ts`, deploy UI copy | Route fails closed with `501`; docs and UI avoid claiming zero-touch account creation is live. | Partial: intentionally blocked on external Stripe Projects orchestration. |
| Code Mode MCP and approval policy | `apps/platform/src/lib/agents-sdk-runtime-template.ts`, `starters/personal-agent/src/agents-sdk.ts`, `starters/personal-agent/src/client.tsx` | Tests assert generated runtime behavior; UI exposes `auto`, `ask-every-time`, `allow-all`, and `full-auto`; Code Mode can be disabled by env. | Complete |
| Executor, Sandbox, Containers, and human-readable tool results | `starters/personal-agent/src/agents-sdk.ts`, `apps/platform/src/lib/agents-sdk-runtime-template.ts`, `starters/personal-agent/Dockerfile`, `starters/personal-agent/wrangler.agents-sdk.jsonc` | Starter/platform builds pass with Sandbox dependency and DO/container declarations; runtime exposes `sandbox_*` tools and executor MCP discovery/call endpoints. | Implemented |
| Orchestrator, sub-agents, and same-Worker MCP/RPC | `apps/platform/src/lib/agents-sdk-runtime-template.ts`, `starters/personal-agent/src/agents-sdk.ts`, `packages/core/src/cloud-agent.ts` | Tests cover generated runtime exports/discovery; runtime exposes workspace orchestrator, child agents, D1 sub-agent messages, and SDK helpers. | Implemented |
| Persona UI, artifacts, learning, search, and browser diagnostics | `starters/personal-agent/src/client.tsx`, `starters/personal-agent/src/client.css`, `starters/personal-agent/src/agents-sdk.ts`, `packages/core/src/cloud-agent.ts` | Starter build passes; SDK tests cover discovery helpers; UI surfaces grouped tools, markdown, artifact canvas modes, learning actions, sub-agent console, and `/browser/diagnostics`. | Implemented |
| Update/reconcile and contribution flows | `apps/platform/src/lib/deployment-update.ts`, `apps/platform/src/lib/update-source.ts`, `apps/platform/src/app/deploy/_components/DeployConsole.tsx`, `packages/core/src/cloud-agent.ts` | Tests cover reconcile uploads, raw fallback rejection for existing Agents SDK deployments, auto-update status recording, Artifacts workspace setup, and GitHub upstream checks against `NeoFlux-Holdings/OpenThink`. | Implemented |
| Attribution guard | `apps/platform/src/lib/__tests__/attribution.test.ts` | Tests scan generated text surfaces for Claude attribution patterns and separate implementation repo references. | Complete |
| Repo-wide validation | Workspace scripts and generated package artifacts | `pnpm typecheck`, `pnpm test -- --runInBand`, `pnpm --filter @open-think/starter-personal-agent build`, `pnpm --filter @open-think/platform build`, `pnpm --filter @open-think/docs build`, `pnpm --dir packages/core pack --pack-destination $env:TEMP`, and `git diff --check` passed on 2026-05-14. | Complete |

Known evidence gaps:

- Live deployed Browser Run diagnostics were visible in an authenticated deployed personal-agent UI after updating from the local OpenThink runtime. The panel reported credentials present but Cloudflare API reachability rejected, so the remaining blocker is account/token/API availability for Browser Rendering rather than missing UI. Re-run after refreshing the token or after the Cloudflare API rate window clears.
- The `/get-messages` and `/chat-history` read-route fix plus the non-blocking Agents SDK warmup fix were uploaded through the current OpenThink `/sync` target on 2026-05-14. A fresh authenticated Chrome tab showed `CONNECTED`, no socket error, enabled composer, no app-side console errors, and a live no-tool probe returned `OK`.
- The sync UI now has a manual known-target fallback so Cloudflare discovery throttling does not strand the user with disabled update controls. If account-wide discovery is rate-limited, the user can enter deployment ID, script name, account ID, and agent URL, then run the same update/reconcile flow against that single Worker.
- Stripe Projects zero-touch Cloudflare account creation, billing-profile setup, and automated domain purchase are not implemented end to end because the public repo does not have an official external orchestration contract to call. The current route correctly fails closed.
- The current pass was committed, pushed, and uploaded through the current OpenThink `/sync` target on 2026-05-14. Local `HEAD`, `origin/main`, and the deployed runtime source matched `a02d402ed160c9cd7d5205ee48141a0c5f23718a` after the final upload.

## Highest-Value Remaining Work

1. Run `/browser/diagnostics` with the live check after refreshing Browser Rendering/API access, then document any account-specific CDP websocket constraints.
2. Finish Stripe-to-Cloudflare account onboarding once the external purchase flow is available. The repo now covers Registrar discovery/check/guarded registration/status tracking for existing Cloudflare accounts, but not automatic account creation or billing-profile setup.
