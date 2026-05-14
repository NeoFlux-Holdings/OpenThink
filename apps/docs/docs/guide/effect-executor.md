# Effect and Executor Workflows

OpenThink uses Effect at async orchestration boundaries where typed failures,
bounded concurrency, and resource lifecycles matter. Keep ordinary UI state and
small pure helpers as plain TypeScript.

Current Effect boundaries:

- Platform scheduled work composes artifact auto-sync and deployment auto-update as one Effect program.
- Deployment auto-update reads deployments, runs reconciles with bounded concurrency, and records per-deployment failures back into metadata.
- Artifact auto-sync exposes both Promise and Effect entry points so API routes can stay simple while Worker cron can compose effects directly.

The executor pattern to copy is not the package manager or framework choice. The useful pattern is a typed runtime boundary: schemas and tagged errors at the edge, services for capabilities, and one runtime that runs the composed workflow.

Implemented integration:

- Generated personal-agent runtimes expose a cloud agent instance profile that names Agents SDK as the chat/state runtime and executor as the default execution-plane contract.
- Agents SDK deployments include a first-party Cloudflare Sandbox/Containers executor bridge by default: the Worker exports `Sandbox`, binds it as a SQLite Durable Object, declares a `cloudflare/sandbox` container image, and sets `SANDBOX_TRANSPORT=rpc`.
- Runtime executor tools are discoverable through `/mcp/tools?server=executor` and callable through `/mcp/call`. Chat also receives `sandbox_ping`, `sandbox_exec`, `sandbox_diff`, `sandbox_read_file`, `sandbox_write_file`, and `sandbox_list_files` tools with the normal approval policy.
- `OPEN_THINK_EXECUTOR_MCP_URL` remains supported for a separate self-hosted or executor.sh-compatible MCP service, with optional bearer auth from `OPEN_THINK_EXECUTOR_AUTH_TOKEN`.
- `/goal` prompts and persistence are executor-aware, so execution-heavy goal steps can route to executor without moving chat streaming or approval ownership out of Agents SDK.
- Sub-agents are modeled as scoped child Cloud Agent Instances. Agents SDK remains the operator/chat runtime, while executor is the right place for sub-agent steps that need process execution, filesystem work, browser automation, OpenAPI execution, or long-running workers.

Executor MCP target:

- The default OpenThink target is the same deployed Worker and its Sandbox Durable Object binding.
- `OPEN_THINK_EXECUTOR_MCP_URL` points to an HTTP MCP endpoint only when you intentionally want a separate execution service, not directly to a raw container.
- It can also point to a self-hosted [`RhysSullivan/executor`](https://github.com/RhysSullivan/executor) deployment or hosted Executor endpoint.
- Sandbox/Containers are the first-party backing plane for code execution, file operations, diff capture, previews, subprocesses, and long-running jobs. Executor is the MCP/governance layer that exposes those capabilities to the agent.

Good places to incorporate [`RhysSullivan/executor`](https://github.com/RhysSullivan/executor):

- Local or container execution plane: run code, filesystem, browser, and subprocess workflows outside the deployed Worker isolate.
- MCP bridge: expose executor-hosted capabilities as MCP tools so the personal agent can discover and call them with the existing approval policy.
- OpenAPI tool ingestion: use executor-style OpenAPI plugins to turn Cloudflare or third-party specs into typed agent tools.
- Deployment preflight: validate generated Worker/Pages code, run tests, and inspect artifacts before upload.
- Long-running agent jobs: put queue/workflow jobs through an executor service when they need non-Worker runtimes or durable task state.

Avoid initially:

- Bundling executor directly into the generated Cloudflare Worker runtime before Worker compatibility and bundle size are proven.
- Replacing Cloudflare Agents SDK chat streaming with executor. Executor should handle execution workflows, not the primary chat transport.
