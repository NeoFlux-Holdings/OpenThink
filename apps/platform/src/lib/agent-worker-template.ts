import type { DeploymentRequest } from "./deployment-engine";
import {
  buildCloudAgentInstanceProfile,
  cloudAgentGoalInstruction
} from "./cloud-agent-instance";
import {
  normalizePersonalAgentConfig,
  publicPersonalAgentConfig
} from "./personal-agent-options";

function inferTemplateModelProvider(
  model: string | undefined
): "workers-ai" | "openrouter" | "anthropic" | "openai" {
  if (!model || model.startsWith("@cf/")) return "workers-ai";
  if (model.startsWith("openrouter/")) return "openrouter";
  if (model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("openai/")) return "openai";
  return "workers-ai";
}

export function renderAgentWorkerModule(input: {
  request: DeploymentRequest;
  deploymentId: string;
  scriptName?: string;
}): string {
  const deploymentId = JSON.stringify(input.deploymentId);
  const starterTemplate = JSON.stringify(input.request.starterTemplate);
  const owner = JSON.stringify(input.request.userId);
  const agentName = JSON.stringify(input.request.agentName?.trim() || "Personal Agent");
  const spendLimitUsd = JSON.stringify(input.request.spendLimitUsd ?? 100);
  const cloudflareAccountId = JSON.stringify(input.request.cloudflareAccountId?.trim() ?? "");
  const scriptName = JSON.stringify(input.scriptName ?? "");
  const defaultModel = JSON.stringify(input.request.defaultModel ?? "@cf/moonshotai/kimi-k2.6");
  const modelProvider = JSON.stringify(input.request.modelProvider ?? inferTemplateModelProvider(input.request.defaultModel));
  const thinkingLevel = JSON.stringify(input.request.thinkingLevel ?? "medium");
  const personalAgentConfig = normalizePersonalAgentConfig(input.request.personalAgent);
  const personalAgentConfigLiteral = JSON.stringify(publicPersonalAgentConfig(personalAgentConfig));
  const cloudAgentInstance = buildCloudAgentInstanceProfile({
    request: input.request,
    deploymentId: input.deploymentId
  });
  const cloudAgentInstanceLiteral = JSON.stringify(cloudAgentInstance);
  const cloudAgentGoalInstructionLiteral = JSON.stringify(
    cloudAgentGoalInstruction(cloudAgentInstance)
  );
  const appHtml = JSON.stringify(renderAgentAppHtml());

  return `
const deploymentId = ${deploymentId};
const starterTemplate = ${starterTemplate};
const owner = ${owner};
const agentName = ${agentName};
const spendLimitUsd = ${spendLimitUsd};
const cloudflareAccountId = ${cloudflareAccountId};
const scriptName = ${scriptName};
const defaultModel = ${defaultModel};
const modelProvider = ${modelProvider};
const thinkingLevel = ${thinkingLevel};
const generatedPersonalAgentConfig = ${personalAgentConfigLiteral};
const generatedCloudAgentInstance = ${cloudAgentInstanceLiteral};
const generatedCloudAgentGoalInstruction = ${cloudAgentGoalInstructionLiteral};
const appHtml = ${appHtml};
const runtimeAwarenessVersion = "2026-05-04.2";
const capabilities = ["chat", "coding", "messaging", "goals", "files", "memory", "tasks", "terminal", "mcp", "cloudflare-api", "self-update", "binding-management", "cloudflare-sandbox-planning", "cloudflare-container-planning", "cloudflare-app-deployment-planning"];
const endpoints = ["/", "/health", "/manifest", "/cloud-agent/profile", "/skills", "/goal", "/subagents", "/subagents/{id}/messages", "/subagents/{id}/control", "/subagents/{id}/summary", "/chat", "/chat?stream=1", "/projects", "/threads", "/messages", "/memory", "/personal-agent/setup", "/files", "/tasks", "/terminal", "/secrets", "/updates/status", "/updates/remote", "/updates/apply", "/updates/bindings", "/runtime/context", "/cloudflare/status", "/cloudflare/api", "/mcp/cloudflare", "/mcp/servers", "/mcp/tools", "/mcp/call"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/app")) {
      return html(appHtml);
    }

    if (url.pathname === "/health") {
      const personalAgent = await personalAgentRuntimeState(env);
      return Response.json({
        ok: true,
        deploymentId,
        starterTemplate,
        agentName,
        owner,
        spendLimitUsd,
        defaultModel: env.OPEN_THINK_DEFAULT_MODEL || defaultModel,
        modelProvider: env.OPEN_THINK_MODEL_PROVIDER || modelProvider,
        thinkingLevel: env.OPEN_THINK_THINKING_LEVEL || thinkingLevel,
        personalAgent,
        cloudAgentInstance: cloudAgentInstanceState(env),
        sdk: cloudAgentInstanceState(env).sdk,
        runtimeAwarenessVersion,
        capabilities,
        slashCommands: {
          goal: goalCommandPayload("", env)
        },
        subAgents: subAgentCapabilityState(env),
        chat: {
          defaultTransport: "server-sent-events",
          streamEndpoint: "/chat?stream=1",
          jsonEndpoint: "/chat",
          agentsSdkWebSocket: "available in package runtime at /agents/personal-chat-agent/default"
        },
        bindings: bindingStatus(env)
      });
    }

    if (url.pathname === "/manifest") {
      const personalAgent = await personalAgentRuntimeState(env);
      return Response.json({
        deploymentId,
        agentName,
        owner,
        status: "ready",
        spendLimitUsd,
        defaultModel: env.OPEN_THINK_DEFAULT_MODEL || defaultModel,
        modelProvider: env.OPEN_THINK_MODEL_PROVIDER || modelProvider,
        thinkingLevel: env.OPEN_THINK_THINKING_LEVEL || thinkingLevel,
        personalAgent,
        cloudAgentInstance: cloudAgentInstanceState(env),
        sdk: cloudAgentInstanceState(env).sdk,
        runtimeAwarenessVersion,
        cloudflareAccountId: env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null,
        capabilities,
        endpoints,
        slashCommands: {
          goal: goalCommandPayload("", env)
        },
        subAgents: subAgentCapabilityState(env),
        chat: {
          transports: ["server-sent-events", "json"],
          streamEndpoint: "/chat?stream=1",
          agentsSdkWebSocket: "/agents/personal-chat-agent/default",
          notes: "Raw Worker deployments stream response chunks over SSE. Agents SDK package deployments use AIChatAgent WebSocket streaming and resumable SQLite chat."
        },
        skills: cloudflarePlatformSkills(env),
        mcp: {
          cloudflareApi: {
            serverUrl: "https://mcp.cloudflare.com/mcp",
            auth: env.OPEN_THINK_CF_API_TOKEN ? "runtime-secret-bridge" : "oauth-recommended",
            tools: ["search", "execute"]
          },
          docs: {
            serverUrl: "https://docs.mcp.cloudflare.com/mcp",
            auth: "none"
          },
          advancedClient: {
            registry: "/mcp/servers",
            tools: "/mcp/tools",
            call: "/mcp/call",
            transport: "streamable-http-json-rpc"
          }
        }
      });
    }

    if (url.pathname === "/cloud-agent/profile") {
      return Response.json(cloudAgentInstanceState(env));
    }

    if (url.pathname === "/skills") {
      return Response.json(cloudflarePlatformSkills(env));
    }

    if (url.pathname === "/goal" && (request.method === "GET" || request.method === "POST")) {
      return handleGoalRequest(request, env);
    }

    if (url.pathname === "/subagents" && request.method === "GET") {
      return handleSubAgentsList(env);
    }

    if (url.pathname === "/subagents" && request.method === "POST") {
      return handleSubAgentCreate(request, env);
    }

    const subAgentRoute = parseSubAgentRoute(url.pathname);
    if (subAgentRoute) {
      return handleSubAgentRoute(request, env, subAgentRoute);
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    if (url.pathname === "/projects" && request.method === "GET") {
      return handleProjectsList(env);
    }

    if (url.pathname === "/projects" && request.method === "POST") {
      return handleProjectCreate(request, env);
    }

    if (url.pathname === "/threads" && request.method === "GET") {
      return handleThreadsList(url, env);
    }

    if (url.pathname === "/threads" && request.method === "POST") {
      return handleThreadCreate(request, env);
    }

    if (url.pathname === "/messages" && request.method === "GET") {
      return handleMessagesList(url, env);
    }

    if (url.pathname === "/memory" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const text = String(payload.text ?? "").trim();
      if (!text) return Response.json({ error: "text is required." }, { status: 400 });
      if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
      await ensureMemoryTable(env);
      const id = crypto.randomUUID();
      await env.DB.prepare("insert into memories (id, text, created_at) values (?, ?, ?)")
        .bind(id, text, new Date().toISOString())
        .run();
      return Response.json({ id, stored: true });
    }

    if (url.pathname === "/memory" && request.method === "GET") {
      if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
      await ensureMemoryTable(env);
      const rows = await env.DB.prepare(
        "select id, text, created_at from memories order by created_at desc limit 50"
      ).all();
      return Response.json({ memories: rows.results ?? [] });
    }

    if (url.pathname === "/personal-agent/setup" && request.method === "GET") {
      return Response.json(await personalAgentRuntimeState(env));
    }

    if (url.pathname === "/files" && request.method === "PUT") {
      if (!env.AGENT_STORAGE) return Response.json({ error: "R2 binding is not configured." }, { status: 503 });
      const key = sanitizeObjectKey(url.searchParams.get("key"));
      if (!key) return Response.json({ error: "key query parameter is required." }, { status: 400 });
      await env.AGENT_STORAGE.put(key, request.body);
      return Response.json({ key, stored: true });
    }

    if (url.pathname === "/files" && request.method === "GET") {
      if (!env.AGENT_STORAGE) return Response.json({ error: "R2 binding is not configured." }, { status: 503 });
      const key = sanitizeObjectKey(url.searchParams.get("key"));
      if (key) {
        const object = await env.AGENT_STORAGE.get(key);
        if (!object) return Response.json({ error: "File not found." }, { status: 404 });
        return new Response(object.body, {
          headers: { "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream" }
        });
      }
      const list = await env.AGENT_STORAGE.list({ limit: 100 });
      return Response.json({
        files: list.objects.map((item) => ({ key: item.key, size: item.size, uploaded: item.uploaded }))
      });
    }

    if (url.pathname === "/tasks" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      if (!env.TASK_QUEUE) return Response.json({ error: "Queue binding is not configured." }, { status: 503 });
      await env.TASK_QUEUE.send({
        deploymentId,
        agentName,
        payload,
        queuedAt: new Date().toISOString()
      });
      return Response.json({ queued: true });
    }

    if (url.pathname === "/terminal") {
      return Response.json({
        transport: "cloudflared-access-or-platform-terminal",
        command: "cloudflared access ssh --hostname " + deploymentId + ".open-think.app",
        note: "Interactive PTY is brokered by the open-think platform TerminalDO when attached."
      });
    }

    if (url.pathname === "/runtime/context") {
      return Response.json(await runtimeSnapshot(env));
    }

    if (url.pathname === "/secrets" && request.method === "GET") {
      return handleSecretsList(env);
    }

    if (url.pathname === "/secrets" && request.method === "PUT") {
      return handleSecretPut(request, env);
    }

    if (url.pathname === "/secrets" && request.method === "DELETE") {
      return handleSecretDelete(url, env);
    }

    if (url.pathname === "/updates/status" && request.method === "GET") {
      return handleUpdateStatus(env);
    }

    if (url.pathname === "/updates/remote" && request.method === "GET") {
      return handleRemoteUpdateStatus(env);
    }

    if (url.pathname === "/updates/apply" && request.method === "POST") {
      return handleUpdateApply(request, env);
    }

    if (url.pathname === "/updates/bindings" && request.method === "GET") {
      return handleBindingsList(env);
    }

    if (url.pathname === "/updates/bindings" && request.method === "PATCH") {
      return handleBindingPatch(request, env);
    }

    if (url.pathname === "/cloudflare/status") {
      const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
      const status = {
        accountId,
        apiTokenAvailable: Boolean(env.OPEN_THINK_CF_API_TOKEN),
        mcpServerUrl: "https://mcp.cloudflare.com/mcp",
        docsMcpServerUrl: "https://docs.mcp.cloudflare.com/mcp",
        mode: env.OPEN_THINK_CF_API_TOKEN ? "runtime-secret" : "oauth-or-user-token-required"
      };

      if (!env.OPEN_THINK_CF_API_TOKEN || !accountId) {
        return Response.json(status);
      }

      const account = await cloudflareApi(env, "/accounts/" + accountId, { method: "GET" });
      return Response.json({ ...status, account });
    }

    if (url.pathname === "/cloudflare/api" && request.method === "POST") {
      return handleCloudflareApi(request, env);
    }

    if (url.pathname === "/mcp/cloudflare") {
      return Response.json({
        serverUrl: "https://mcp.cloudflare.com/mcp",
        docsServerUrl: "https://docs.mcp.cloudflare.com/mcp",
        mode: env.OPEN_THINK_CF_API_TOKEN ? "runtime-secret-bridge" : "oauth-required-for-official-remote",
        authorization: env.OPEN_THINK_CF_API_TOKEN ? "OPEN_THINK_CF_API_TOKEN is available as a Worker secret." : "Connect with Cloudflare OAuth or add a runtime token.",
        tools: cloudflareMcpTools(),
        accountId: env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null
      });
    }

    if (url.pathname === "/mcp/servers" && request.method === "GET") {
      return Response.json({ servers: await listMcpServers(env) });
    }

    if (url.pathname === "/mcp/servers" && request.method === "POST") {
      return handleMcpServerRegister(request, env);
    }

    if (url.pathname === "/mcp/servers" && request.method === "DELETE") {
      return handleMcpServerRemove(request, env);
    }

    if (url.pathname === "/mcp/tools" && request.method === "GET") {
      return handleMcpTools(url, env);
    }

    if (url.pathname === "/mcp/call" && request.method === "POST") {
      return handleMcpCall(request, env);
    }

    return Response.json({
      deploymentId,
      starterTemplate,
      agentName,
      owner,
      status: "ready",
      capabilities,
      endpoints,
      cloudAgentInstance: cloudAgentInstanceState(env),
      slashCommands: {
        goal: goalCommandPayload("", env)
      },
      subAgents: subAgentCapabilityState(env)
    });
  }
};

async function handleGoalRequest(request, env) {
  if (request.method === "GET") {
    return Response.json(goalCommandPayload("", env));
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const payload = await request.json().catch(() => ({}));
  const goal = String(payload.goal ?? payload.text ?? payload.message ?? "").trim();
  return Response.json(goalCommandPayload(goal, env));
}

function goalCommandPayload(goal = "", env) {
  const trimmedGoal = String(goal || "").trim();
  return {
    enabled: true,
    command: "/goal",
    endpoint: "/goal",
    cloudAgentInstance: env ? cloudAgentInstanceState(env) : generatedCloudAgentInstance,
    usage: ["/goal Ship the deployment updater", "/goal"],
    behavior: "Turns a requested objective into an active goal brief with success criteria, milestones, next actions, risks, and a resume prompt.",
    prompt: goalCommandPrompt(trimmedGoal)
  };
}

function goalCommandPrompt(goal) {
  if (!goal) {
    return [
      "Goal command received with no goal text.",
      "Review active goals from this conversation and any available memory.",
      "If no active goal is clear, ask the owner for the objective in one concise question."
    ].join("\\n");
  }

  return [
    "Goal command received.",
    "",
    "Active goal: " + goal,
    "",
    "Create a concise goal brief with objective, success criteria, constraints, milestones, next actions, risks, and a resume prompt.",
    "Use available memory, task, file, or MCP tools when helpful to persist or advance the goal. If those tools are unavailable, keep the goal in conversation state and say what would be persisted when available."
  ].join("\\n");
}

function goalCommandInstruction() {
  return [
    "Slash command /goal is enabled.",
    "When the owner's message begins with /goal, treat the remaining text as an active goal setup or update.",
    "If the command includes a goal, respond with a compact goal brief: objective, success criteria, constraints, milestones, next actions, risks, and a resume prompt.",
    "If the command has no goal text, review active goals from conversation and memory when available, then ask for the missing objective only if needed.",
    "Call set_active_goal after drafting or updating a goal so the brief is persisted when D1 is bound.",
    "Use available memory, task, file, or MCP tools when helpful to persist or advance the goal; otherwise keep the goal anchored in the chat state."
  ].join("\\n");
}

function cloudAgentInstanceState(env) {
  const executorUrl = sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL);
  return {
    ...generatedCloudAgentInstance,
    skills: (generatedCloudAgentInstance.skills || []).map((skill) =>
      skill.id === "executor-mcp" ? { ...skill, enabled: Boolean(executorUrl) } : skill
    ),
    execution: {
      ...generatedCloudAgentInstance.execution,
      executor: {
        ...generatedCloudAgentInstance.execution.executor,
        enabled: Boolean(executorUrl),
        configured: Boolean(executorUrl),
        mcpServerUrl: executorUrl ? "configured" : null,
        authTokenConfigured: Boolean(env.OPEN_THINK_EXECUTOR_AUTH_TOKEN)
      }
    }
  };
}

function cloudAgentInstanceInstruction(env) {
  return [
    generatedCloudAgentGoalInstruction,
    "Runtime cloud agent instance state:",
    JSON.stringify(cloudAgentInstanceState(env), null, 2)
  ].join("\\n\\n");
}

function subAgentCapabilityState(env) {
  return {
    enabled: true,
    persistence: env.DB ? "D1 sub_agents and sub_agent_messages" : "unavailable until DB binding is configured",
    endpoints: ["/subagents", "/subagents/{id}", "/subagents/{id}/messages", "/subagents/{id}/control", "/subagents/{id}/summary"],
    controls: ["create", "pause", "resume", "archive", "summarize", "message", "brief-main-chat"],
    modes: ["agents-sdk", "executor", "hybrid"]
  };
}

async function handleChat(request, env) {
  const url = new URL(request.url);
  const payload = await request.json().catch(() => ({}));
  const message = String(payload.message ?? "").trim();
  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  const modelSettings = resolveModelSettings(env);
  if (modelSettings.provider === "workers-ai" && !env.AI) {
    return Response.json({ error: "Workers AI binding is not configured." }, { status: 503 });
  }

  const wantsStream = payload.stream === true ||
    url.searchParams.get("stream") === "1" ||
    (request.headers.get("accept") || "").toLowerCase().includes("text/event-stream");

  if (wantsStream) {
    return streamChatResponse(payload, env, modelSettings);
  }

  return Response.json(await resolveChatResponse(payload, env, modelSettings));
}

function streamChatResponse(payload, env, modelSettings) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode("event: " + event + "\\ndata: " + JSON.stringify(data) + "\\n\\n"));
      };

      Promise.resolve()
        .then(async () => {
          send("status", { status: "thinking" });
          const result = await resolveChatResponse(payload, env, modelSettings);
          send("metadata", {
            deploymentId: result.deploymentId,
            projectId: result.projectId,
            threadId: result.threadId,
            model: result.model,
            modelProvider: result.modelProvider
          });
          for (const chunk of textChunks(result.output)) {
            send("delta", { content: chunk });
            await Promise.resolve();
          }
          send("done", result);
          controller.close();
        })
        .catch((error) => {
          send("error", { error: error instanceof Error ? error.message : "Chat stream failed." });
          controller.close();
        });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

async function resolveChatResponse(payload, env, modelSettings) {
  const message = String(payload.message ?? "").trim();
  let projectId = String(payload.projectId ?? "").trim();
  let threadId = String(payload.threadId ?? "").trim();
  let history = [];
  if (env.DB) {
    await ensureConversationTables(env);
    await ensurePersonalAgentSetup(env);
    projectId = projectId || await ensureDefaultProject(env);
    threadId = threadId || await ensureDefaultThread(env, projectId);
    history = await recentConversationMessages(env, threadId, 10);
    await saveConversationMessage(env, threadId, "user", message);
  }

  const runtime = await runtimeSnapshot(env);
  const personalAgent = resolvePersonalAgentConfig(env);
  const memoryContext = await memoryList(env, 12).catch((error) => ({
    available: false,
    error: error instanceof Error ? error.message : "Memory lookup failed.",
    memories: []
  }));
  const context = [
    "Runtime snapshot:",
    JSON.stringify(runtime, null, 2),
    "Current project/thread:",
    JSON.stringify({ projectId: projectId || null, threadId: threadId || null }, null, 2),
    "Recent D1 memory rows:",
    JSON.stringify(memoryContext, null, 2)
  ].join("\\n");

  const messages = [
    {
      role: "system",
      content: [
        "You are " + agentName + ", an open-think personal agent running on Cloudflare.",
        "You help with coding, messaging, chat, task planning, files, memory, Cloudflare operations, terminal workflows, source updates, MCP-oriented tool use, and selecting the right Cloudflare primitive for new software.",
        personalAgentSystemInstruction(personalAgent),
        "You have direct awareness of this deployment through the runtime snapshot below. Do not say you lack the script name, D1 memory table, bindings, update strategy, or Cloudflare account context when it is present in that snapshot.",
        cloudAgentInstanceInstruction(env),
        goalCommandInstruction(),
        "You have explicit Cloudflare platform skills in the runtime snapshot. When asked about Sandbox, Containers, Workers, Pages, or deploying new software, use those skills. Do not claim Containers or Sandbox are impossible; say whether they are available in this runtime, what account plan/bindings are required, and how you would add them.",
        "Decision rule: Workers/Pages first for HTTP apps, APIs, static sites, scheduled jobs, queues, and edge-native integrations. Sandbox for untrusted or agent-generated code execution, command execution, file work, browser terminals, preview URLs, data analysis, and ephemeral IDE/CI workflows. Containers for custom runtimes, existing Docker images, long-running services, heavier CPU/memory/disk, Linux tools, or servers that Workers cannot run. Durable Objects coordinate stateful sessions and per-user instances. R2, D1, Queues, Vectorize, AI, Workflows, and Access compose around these choices.",
        "Builder workflow: first classify the requested software, then propose the smallest Cloudflare architecture, list required permissions/bindings/resources, identify paid-plan or beta gates, create a deployment plan, ask before cost-bearing/destructive operations, then use MCP/API/update tools to provision or generate the code. If the current runtime lacks a binding, explain the exact binding/config update needed instead of saying the feature is unavailable.",
        "Safety workflow for executable code: never run untrusted code in the Worker isolate. Prefer Sandbox for short-lived command/code execution and Containers for custom runtimes or long-running services. For secrets, use Worker secrets and never echo values. For public apps, include Access, custom domain/DNS, spend guardrails, logging, rollback, and update strategy.",
        "D1 memory is available through the built-in memory_list tool and the /memory endpoint. If asked what memory says, answer from recent D1 memory rows or call memory_list. Do not ask the owner for the D1 database id for this agent's own memory.",
        "R2 files are available through files_list and /files. Tasks are available through queue_task and /tasks. Runtime and update status are available through runtime_status and /runtime/context.",
        "Vectorize is provisioned as semantic memory when the VECTORIZE binding is present; explain that vector query wiring is a next runtime tool if no direct vector query tool is available.",
        "For source updates, explain three lanes: default managed updates from the configured GitHub NeoFlux-Holdings/OpenThink repository through the platform reconciler; optional self-editing through a per-agent Cloudflare Artifacts workspace plus Sandbox/Containers when enabled; and this runtime's /updates/apply endpoint for a verified built worker.js bundle. Managed GitHub updates are preferred for upstream releases. The Artifacts/Sandbox lane is for agent-authored changes, tests, diffs, and PR preparation, and can be added later when the account has paid capabilities.",
        "For resets, prefer the platform /api/deployment/update action reset. Source restore reuploads the generated Worker from GitHub and keeps workspace metadata and the current personal-agent brain. Factory reset also disables auto update, removes workspace metadata and custom non-secret bindings, clears the personal-agent brain unless the reset payload reconfigures it, restores Kimi K2.6 Workers AI defaults, and preserves encrypted Worker secrets. Require explicit owner confirmation before reset.",
        "If local agent changes and remote updates both exist, use this order: snapshot current runtime status, identify local changes or bindings/secrets, fetch remote status, propose rebase or reconcile, ask before destructive replacement, then deploy with secret preservation. Treat this as the update-management playbook.",
        "Secrets are managed through /secrets and the secret_put tool. Non-secret bindings are managed through /updates/bindings and the binding_add tool, which patches Worker script settings. For new resource-backed bindings, create or identify the Cloudflare resource first, then bind its id/name.",
        "When the owner asks for Cloudflare operations, use the mcp_call tool. For destructive or expensive actions, explain the exact operation and ask for confirmation before using execute.",
        "Keep responses operational, concrete, and scoped to the owner. Return readable Markdown, not JSON wrappers.",
        context
      ].join("\\n\\n")
    },
    ...history.map((item) => ({ role: item.role === "agent" ? "assistant" : "user", content: item.content })),
    { role: "user", content: message }
  ];

  const output = await runModel(env, modelSettings, messages, { tools: agentTools() });
  let responseText = normalizeModelOutput(output);
  const toolCalls = extractToolCalls(output, responseText);
  let toolResults = [];
  if (toolCalls.length > 0) {
    toolResults = await runToolCalls(toolCalls, env);
    const followupMessages = [
      ...messages,
      { role: "assistant", content: responseText },
      {
        role: "user",
        content: "Tool results are below. Summarize the result for the owner in readable Markdown and mention any follow-up action needed.\\n\\n" + JSON.stringify(toolResults, null, 2)
      }
    ];
    const followup = await runModel(env, modelSettings, followupMessages, {});
    responseText = normalizeModelOutput(followup);
  }
  if (env.DB && threadId) {
    await saveConversationMessage(env, threadId, "agent", responseText);
  }

  return {
    deploymentId,
    starterTemplate,
    projectId: projectId || null,
    threadId: threadId || null,
    model: modelSettings.model,
    modelProvider: modelSettings.provider,
    output: responseText,
    toolResults,
    usage: output?.usage ?? null
  };
}

function textChunks(text) {
  const value = String(text || "");
  const chunks = [];
  const size = 220;
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks.length ? chunks : [""];
}

function resolveModelSettings(env) {
  const model = env.OPEN_THINK_DEFAULT_MODEL || defaultModel;
  const provider = env.OPEN_THINK_MODEL_PROVIDER || (model.startsWith("@cf/") ? "workers-ai" : modelProvider);
  return {
    model,
    provider,
    thinkingLevel: env.OPEN_THINK_THINKING_LEVEL || thinkingLevel
  };
}

async function runModel(env, settings, messages, options = {}) {
  if (settings.provider === "workers-ai") {
    return env.AI.run(settings.model, {
      messages,
      ...(options.tools ? { tools: options.tools, tool_choice: "auto" } : {})
    });
  }

  if (settings.provider === "anthropic") {
    return runAnthropicModel(env, settings, messages);
  }

  return runOpenAiCompatibleModel(env, settings, messages);
}

async function runOpenAiCompatibleModel(env, settings, messages) {
  const provider = settings.provider === "openrouter" ? "openrouter" : "openai";
  const key = provider === "openrouter" ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;
  if (!key) {
    return { response: "The selected " + provider + " model needs a stored API key. Add it in the Secrets tab or choose Kimi K2.6 on Workers AI." };
  }
  const endpoint = provider === "openrouter"
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const model = settings.model.replace(/^openrouter\\//, "").replace(/^openai\\//, "");
  const body = {
    model,
    messages,
    ...(provider === "openai" ? { reasoning: { effort: settings.thinkingLevel } } : {})
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(provider === "openrouter" ? { "HTTP-Referer": "https://open-think.app", "X-Title": "open-think personal agent" } : {})
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function runAnthropicModel(env, settings, messages) {
  if (!env.ANTHROPIC_API_KEY) {
    return { response: "The selected Anthropic model needs ANTHROPIC_API_KEY. Add it in the Secrets tab or choose Kimi K2.6 on Workers AI." };
  }
  const system = messages.find((message) => message.role === "system")?.content || "";
  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model.replace(/^anthropic\\//, ""),
      system,
      messages: anthropicMessages,
      max_tokens: 4096,
      thinking: settings.thinkingLevel === "low" ? undefined : { type: "enabled", budget_tokens: settings.thinkingLevel === "xhigh" ? 8192 : settings.thinkingLevel === "high" ? 4096 : 2048 }
    })
  });
  return response.json();
}

function normalizeModelOutput(output) {
  if (typeof output === "string") return output;
  if (typeof output?.response === "string") return output.response;
  if (typeof output?.text === "string") return output.text;
  if (typeof output?.content === "string") return output.content;
  if (Array.isArray(output?.content)) {
    return output.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.text) return part.text;
        if (part?.content) return part.content;
        if (part?.input) return JSON.stringify(part.input);
        return "";
      })
      .filter(Boolean)
      .join("\\n");
  }
  const choice = output?.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content
      .map((part) => typeof part === "string" ? part : part?.text ?? "")
      .filter(Boolean)
      .join("\\n");
  }
  return JSON.stringify(output, null, 2);
}

function agentTools() {
  return [
    {
      type: "function",
      function: {
        name: "runtime_status",
        description: "Return the current open-think runtime snapshot, including bindings, script name, endpoints, and update capabilities.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    {
      type: "function",
      function: {
        name: "memory_list",
        description: "Read recent memories stored in the agent's D1 memory table.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of memories to return." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "set_active_goal",
        description: "Persist the owner's active /goal brief into D1 memory when the DB binding is available.",
        parameters: {
          type: "object",
          properties: {
            goal: { type: "string", description: "The active goal objective." },
            successCriteria: {
              type: "array",
              items: { type: "string" },
              description: "How the owner and agent will know the goal is complete."
            },
            milestones: {
              type: "array",
              items: { type: "string" },
              description: "Major checkpoints for the goal."
            },
            nextActions: {
              type: "array",
              items: { type: "string" },
              description: "Concrete next actions to take."
            },
            notes: { type: "string", description: "Optional constraints, risks, or context." }
          },
          required: ["goal"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_sub_agent",
        description: "Create a D1-tracked Cloud Agent Instance sub-agent for delegated work.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            systemPrompt: { type: "string" },
            brain: { type: "string" },
            skills: { type: "array", items: { type: "string" } },
            mode: { type: "string", enum: ["agents-sdk", "executor", "hybrid"] },
            model: { type: "string" }
          },
          required: ["name", "purpose"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "sub_agent_control",
        description: "Pause, resume, mark working, or archive a tracked sub-agent.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["ready", "working", "paused", "archived"] }
          },
          required: ["id", "status"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "sub_agent_message",
        description: "Send a message to a tracked sub-agent and receive its response.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
            message: { type: "string" }
          },
          required: ["id", "message"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "sub_agent_summary",
        description: "Refresh and return a concise summary for a tracked sub-agent.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" }
          },
          required: ["id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "files_list",
        description: "List recent artifact keys from the agent's R2 storage bucket.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum number of files to return." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "queue_task",
        description: "Queue a task into the agent's Cloudflare Queue.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
            payload: { type: "object" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "secret_put",
        description: "Store or update a Worker secret for this agent. Secret values cannot be read back later.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Uppercase secret name, for example OPENAI_API_KEY." },
            value: { type: "string", description: "Secret value to store." }
          },
          required: ["name", "value"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "binding_add",
        description: "Add or replace a non-secret Worker binding by patching this Worker's script settings.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["plain_text", "r2_bucket", "d1", "queue", "vectorize", "kv_namespace", "service"] },
            name: { type: "string" },
            text: { type: "string", description: "For plain_text bindings." },
            id: { type: "string", description: "D1 database id or KV namespace id." },
            bucket_name: { type: "string" },
            queue_name: { type: "string" },
            index_name: { type: "string" },
            service: { type: "string" }
          },
          required: ["type", "name"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "update_status",
        description: "Inspect this Worker's update and binding-management readiness.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    {
      type: "function",
      function: {
        name: "cloudflare_platform_advice",
        description: "Choose between Workers, Pages, Sandbox, Containers, Durable Objects, and supporting Cloudflare services for a software or agent deployment.",
        parameters: {
          type: "object",
          properties: {
            goal: { type: "string", description: "What the owner wants to build or deploy." },
            needsCodeExecution: { type: "boolean" },
            needsCustomRuntime: { type: "boolean" },
            needsLongRunningServer: { type: "boolean" },
            needsStaticFrontend: { type: "boolean" },
            needsStatefulSessions: { type: "boolean" },
            untrustedCode: { type: "boolean" }
          },
          required: ["goal"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "mcp_call",
        description: "Call an MCP-compatible tool from the agent runtime.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "MCP server id or name. Use cloudflare for Cloudflare API or executor for the default executor MCP execution plane when configured." },
            name: { type: "string", description: "Tool name. Use search or execute for Cloudflare; use the discovered executor tool name for executor." },
            arguments: { type: "object" }
          },
          required: ["name", "arguments"]
        }
      }
    }
  ];
}

function extractToolCalls(output, responseText) {
  const calls = [];
  const rawCalls =
    output?.tool_calls ??
    output?.choices?.[0]?.message?.tool_calls ??
    output?.result?.tool_calls ??
    [];

  for (const call of rawCalls || []) {
    const fn = call.function ?? call;
    const name = fn.name || call.name;
    if (!name) continue;
    let args = fn.arguments ?? call.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    calls.push({ name, arguments: args });
  }

  const xmlCalls = String(responseText ?? "").matchAll(/<invoke\\s+name=["']mcp_call["'][\\s\\S]*?<\\/invoke>/g);
  for (const match of xmlCalls) {
    const block = match[0];
    const name = extractXmlParameter(block, "name") || "search";
    const server = extractXmlParameter(block, "server") || "cloudflare";
    const argsText = extractXmlParameter(block, "arguments") || "{}";
    let args = {};
    try {
      args = JSON.parse(argsText);
    } catch {
      args = { query: argsText };
    }
    calls.push({ name: "mcp_call", arguments: { server, name, arguments: args } });
  }

  const builtInXmlCalls = String(responseText ?? "").matchAll(/<invoke\\s+name=["'](runtime_status|memory_list|set_active_goal|create_sub_agent|sub_agent_control|sub_agent_message|sub_agent_summary|files_list|queue_task|secret_put|binding_add|update_status|cloudflare_platform_advice)["'][\\s\\S]*?<\\/invoke>/g);
  for (const match of builtInXmlCalls) {
    const block = match[0];
    const toolName = match[1];
    const argsText = extractXmlParameter(block, "arguments") || "{}";
    let args = {};
    try {
      args = JSON.parse(argsText);
    } catch {
      args = {};
    }
    calls.push({ name: toolName, arguments: args });
  }

  return calls.slice(0, 5);
}

function extractXmlParameter(block, name) {
  const match = block.match(new RegExp("<parameter\\\\s+name=[\\"']" + name + "[\\"']>([\\\\s\\\\S]*?)<\\\\/parameter>"));
  return match?.[1]?.trim();
}

async function runToolCalls(calls, env) {
  const results = [];
  for (const call of calls) {
    if (call.name === "runtime_status") {
      results.push({ tool: "runtime_status", result: await runtimeSnapshot(env) });
      continue;
    }

    if (call.name === "memory_list") {
      results.push({
        tool: "memory_list",
        result: await memoryList(env, Number(call.arguments?.limit ?? 20))
      });
      continue;
    }

    if (call.name === "set_active_goal") {
      results.push({
        tool: "set_active_goal",
        result: await setActiveGoal(env, call.arguments ?? {})
      });
      continue;
    }

    if (call.name === "create_sub_agent") {
      results.push({
        tool: "create_sub_agent",
        result: await createSubAgent(env, call.arguments ?? {})
      });
      continue;
    }

    if (call.name === "sub_agent_control") {
      results.push({
        tool: "sub_agent_control",
        result: await updateSubAgentStatus(env, call.arguments?.id, normalizeSubAgentStatus(call.arguments?.status, "ready"))
      });
      continue;
    }

    if (call.name === "sub_agent_message") {
      results.push({
        tool: "sub_agent_message",
        result: await sendSubAgentMessage(env, call.arguments?.id, String(call.arguments?.message ?? ""))
      });
      continue;
    }

    if (call.name === "sub_agent_summary") {
      results.push({
        tool: "sub_agent_summary",
        result: await refreshSubAgentSummary(env, call.arguments?.id)
      });
      continue;
    }

    if (call.name === "files_list") {
      results.push({
        tool: "files_list",
        result: await filesList(env, Number(call.arguments?.limit ?? 50))
      });
      continue;
    }

    if (call.name === "queue_task") {
      results.push({
        tool: "queue_task",
        result: await queueTask(env, call.arguments ?? {})
      });
      continue;
    }

    if (call.name === "secret_put") {
      results.push({
        tool: "secret_put",
        result: await putWorkerSecret(env, call.arguments ?? {})
      });
      continue;
    }

    if (call.name === "binding_add") {
      results.push({
        tool: "binding_add",
        result: await patchWorkerBinding(env, call.arguments ?? {})
      });
      continue;
    }

    if (call.name === "update_status") {
      results.push({
        tool: "update_status",
        result: await updateStatusPayload(env)
      });
      continue;
    }

    if (call.name === "cloudflare_platform_advice") {
      results.push({
        tool: "cloudflare_platform_advice",
        result: cloudflarePlatformAdvice(env, call.arguments ?? {})
      });
      continue;
    }

    const args = call.name === "mcp_call" ? call.arguments : { name: call.name, arguments: call.arguments };
    const server = args.server || "cloudflare";
    const toolName = args.name || call.name;
    const toolArgs = args.arguments || args.args || {};
    const result = server === "cloudflare"
      ? await callCloudflareMcpTool(toolName, toolArgs, env)
      : server === "executor"
        ? await callExecutorMcpTool(toolName, toolArgs, env)
        : { ok: false, error: "Only cloudflare and executor MCP bridges are currently available from chat." };
    results.push({ server, tool: toolName, arguments: toolArgs, result });
  }
  return results;
}

async function handleCloudflareApi(request, env) {
  if (!env.OPEN_THINK_CF_API_TOKEN) {
    return Response.json(
      { error: "Cloudflare API runtime secret is not configured." },
      { status: 503 }
    );
  }

  const payload = await request.json().catch(() => ({}));
  const method = String(payload.method ?? "GET").toUpperCase();
  const path = String(payload.path ?? "").trim();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return Response.json({ error: "Unsupported Cloudflare API method." }, { status: 400 });
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return Response.json({ error: "Path must be a Cloudflare API path such as /accounts/{id}." }, { status: 400 });
  }

  const init = { method };
  if (payload.body !== undefined && method !== "GET") {
    init.body = JSON.stringify(payload.body);
  }
  const result = await cloudflareApi(env, path, init);
  return Response.json({ result });
}

function runtimeScriptName(env) {
  return env.OPEN_THINK_SCRIPT_NAME || scriptName;
}

function cloudflarePlatformSkills(env) {
  const sandboxBound = Boolean(env.Sandbox || env.SANDBOX || env.OPEN_THINK_SANDBOX_ENABLED === "true");
  const containerBound = Boolean(env.OPEN_THINK_CONTAINER_ENABLED === "true" || env.AGENT_CONTAINER || env.MY_CONTAINER);
  return {
    version: "2026-05-04.2",
    currentRuntime: {
      runsIn: "Cloudflare Worker",
      canSelfModifyThroughWorkerUpload: Boolean(env.OPEN_THINK_CF_API_TOKEN),
      executorMcpConfigured: Boolean(sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL)),
      sandboxBound,
      containerBound,
      paidPlanRequiredForSandboxAndContainers: true
    },
    operatingPrinciples: [
      "Prefer the smallest Cloudflare primitive that satisfies the product requirement.",
      "Treat Workers/Pages as the default deploy targets for web apps and APIs.",
      "Never execute untrusted code in the Worker isolate; use Sandbox or Containers.",
      "Separate planning from execution: explain resources, permissions, cost/plan gates, rollback, and security before provisioning.",
      "Use secrets for credentials, plain-text vars only for non-sensitive configuration, and never claim secret values can be read back.",
      "For owner-requested Cloudflare changes, use MCP search first when unsure, then execute only after confirmation for destructive or expensive operations."
    ],
    requiredTokenCoverage: {
      currentPreset: [
        "Workers Scripts Edit",
        "Containers Edit / Cloudchamber Edit",
        "Cloudflare Pages Edit",
        "Workers KV Storage Edit",
        "D1 Edit",
        "Workers R2 Storage Edit",
        "Queues Edit",
        "Vectorize Edit",
        "Workers AI Read",
        "AI Gateway Edit",
        "Access Apps and Policies Edit",
        "Zone Read",
        "DNS Edit",
        "Workers Routes Edit",
        "Account Settings Read",
        "User Details Read"
      ],
      addLaterWhenNeeded: [
        "Hyperdrive Edit for Postgres/database connectivity",
        "Workflows Edit if adding long-running workflow orchestration",
        "Turnstile Edit for bot protection",
        "Images/Stream Edit for media apps",
        "Observability/log permissions if the owner wants tailing or log sinks"
      ]
    },
    builderPlaybooks: [
      {
        id: "new-cloudflare-app",
        trigger: "Owner asks to create or deploy new software on Cloudflare.",
        steps: [
          "Clarify app type, runtime needs, state, data, auth, domain, expected traffic, and cost tolerance.",
          "Choose Workers, Pages, Sandbox, Containers, or a combination using the decision matrix.",
          "List resources/bindings: D1, R2, KV, Queues, Vectorize, AI Gateway, Access, DNS/routes, Durable Objects, Workflows.",
          "Check token/plan readiness and call out missing permissions or paid-plan gates.",
          "Generate code and wrangler config, then deploy through the platform update flow or Cloudflare API.",
          "Verify health, route/domain, Access policy, rollback path, logs, and update source."
        ]
      },
      {
        id: "sandbox-code-execution",
        trigger: "Owner wants to run code, tests, shell commands, notebooks, or agent-generated code.",
        steps: [
          "Use Sandbox SDK if the code is untrusted, interactive, short-lived, or needs files/terminal/preview URLs.",
          "Add @cloudflare/sandbox, export Sandbox, add Durable Object binding/migration, and expose exec/files/terminal endpoints.",
          "Persist artifacts to R2 and metadata to D1; proxy credentials from Worker secrets instead of exposing them to the sandbox.",
          "Require explicit confirmation for package installs, network-heavy jobs, destructive file operations, or long-running commands."
        ]
      },
      {
        id: "containerized-service",
        trigger: "Owner needs Docker, custom Linux runtime, an existing server app, heavier CPU/memory/disk, or long-running service behavior.",
        steps: [
          "Use Containers directly with @cloudflare/containers and a Container subclass.",
          "Define Dockerfile, defaultPort, sleepAfter, instance type, max_instances, Durable Object binding, and migration.",
          "Route by tenant/session with getContainer(env.CONTAINER, id).fetch(request).",
          "Protect public routes with Access, set custom domains/routes, and document scale-to-zero/cost behavior."
        ]
      },
      {
        id: "self-update-and-redeploy",
        trigger: "Owner asks the agent to change its own code, bindings, or deployed resources.",
        steps: [
          "Prefer managed remote updates from the open-think GitHub source and platform reconciler.",
          "For direct runtime updates, require a verified worker.js bundle and preserve secrets with keep_bindings.",
          "For bindings/secrets, use /updates/bindings and /secrets; create backing Cloudflare resources first when needed.",
          "Warn that replacing the current Worker can interrupt the conversation and ask for confirmation before upload."
        ]
      }
    ],
    skills: [
      {
        id: "executor-mcp-cloud-agent",
        name: "Executor MCP execution plane",
        docs: "https://github.com/RhysSullivan/executor",
        status: sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL) ? "configured" : "not-configured",
        whatItIs: "An optional external execution plane for cloud agent instances. Agents SDK keeps chat streaming, state, MCP orchestration, and approvals; executor handles workloads that belong outside the Worker isolate.",
        useWhen: [
          "Need code execution, subprocesses, filesystem work, browser automation, OpenAPI execution, or workflow workers.",
          "Need an agent skill runtime that can evolve independently from this personal-agent Worker.",
          "Need to compose gbrain/gskills goals with a typed execution service instead of running arbitrary code in the chat runtime."
        ],
        addToThisAgent: [
          "Deploy or host executor as an MCP-capable service.",
          "Set OPEN_THINK_EXECUTOR_MCP_URL to its HTTPS MCP endpoint.",
          "Optionally set OPEN_THINK_EXECUTOR_AUTH_TOKEN when the executor endpoint requires bearer auth.",
          "Use /goal to anchor objectives; the agent will prefer executor for execution-heavy steps when configured."
        ]
      },
      {
        id: "cloudflare-sandbox",
        name: "Cloudflare Sandbox SDK",
        docs: "https://developers.cloudflare.com/sandbox/",
        status: sandboxBound ? "bound-or-enabled" : "not-bound-yet",
        paidPlan: "Workers Paid plan required because Sandbox is built on Containers.",
        whatItIs: "A high-level SDK for secure isolated code execution environments backed by Cloudflare Containers and coordinated from Workers/Durable Objects.",
        useWhen: [
          "Need to execute untrusted or agent-generated code safely.",
          "Need shell commands, Python or Node execution, file operations, code interpreter behavior, background processes, file watching, browser terminals, or preview URLs.",
          "Need an AI coding agent, code-review bot, data-analysis notebook, test runner, CI job, or cloud IDE session."
        ],
        avoidWhen: [
          "A plain HTTP API, static site, or scheduled task is enough.",
          "You need a bespoke long-running production service with a custom container image; use Containers directly."
        ],
        addToThisAgent: [
          "Add @cloudflare/sandbox to the generated runtime package.",
          "Export { Sandbox } from @cloudflare/sandbox in the Worker module.",
          "Add a Durable Object binding for Sandbox in wrangler config/migrations.",
          "Expose endpoints for exec, files, terminal WebSocket, previews, and lifecycle.",
          "Gate expensive/destructive execution behind owner confirmation and spending limits."
        ]
      },
      {
        id: "cloudflare-containers",
        name: "Cloudflare Containers",
        docs: "https://developers.cloudflare.com/containers/",
        status: containerBound ? "bound-or-enabled" : "not-bound-yet",
        paidPlan: "Workers Paid plan required.",
        whatItIs: "A serverless container runtime for running Docker/container images from Workers, with instances addressed and coordinated through Durable Object bindings.",
        useWhen: [
          "Need a custom runtime, existing Docker image, native Linux packages, full filesystem, more CPU/memory/disk, or a non-JavaScript server.",
          "Need long-running or stateful service instances, WebSocket-to-container, SSH/debug workflows, R2 FUSE mounts, or containerized backends.",
          "Need to deploy software that cannot fit inside Worker limits."
        ],
        avoidWhen: [
          "Workers or Pages can serve the request without a custom runtime.",
          "The main need is safe code execution for an AI agent; prefer Sandbox first."
        ],
        addToThisAgent: [
          "Add @cloudflare/containers and a Container subclass with defaultPort and sleepAfter.",
          "Add containers[] and durable_objects.bindings[] in wrangler config plus SQLite migration.",
          "Build/push the Dockerfile during deploy.",
          "Route per-user/session IDs to getContainer(env.CONTAINER, id).fetch(request).",
          "Define scale-to-zero, max_instances, instance type, and Access protections."
        ]
      },
      {
        id: "cloudflare-deployment-picker",
        name: "Cloudflare deployment picker",
        docs: "https://developers.cloudflare.com/",
        status: "available",
        useWhen: [
          "Owner asks where to deploy a new app or service.",
          "Owner asks whether to use Workers, Pages, Sandbox, Containers, Durable Objects, R2, D1, Queues, Vectorize, Workflows, or Access."
        ],
        decisionMatrix: [
          "Static frontend or docs: Pages, optionally with Functions/Workers for APIs.",
          "HTTP API, webhook, bot, scheduled job, queue consumer, AI Gateway/router: Workers.",
          "Per-user state, sessions, WebSocket coordination, singleton controllers: Durable Objects.",
          "Untrusted code execution, command runner, code interpreter, terminal, test/build job: Sandbox.",
          "Custom runtime, existing Docker app, heavier Linux service, server needing CPU/memory/disk: Containers.",
          "Large files/artifacts: R2. Relational data: D1. Background async tasks: Queues/Workflows. Semantic memory/RAG: Vectorize/AutoRAG. Access control: Cloudflare Access."
        ]
      }
    ]
  };
}

function cloudflarePlatformAdvice(env, input) {
  const skills = cloudflarePlatformSkills(env);
  const goal = String(input.goal ?? "").toLowerCase();
  const reasons = [];
  let primary = "workers";
  if (input.needsStaticFrontend || /static|landing|docs|frontend|site/.test(goal)) {
    primary = "pages";
    reasons.push("Static/front-end delivery fits Pages, with Workers/Functions for dynamic APIs.");
  }
  if (input.untrustedCode || input.needsCodeExecution || /sandbox|execute code|run code|terminal|python|notebook|ci|tests|build/.test(goal)) {
    primary = "sandbox";
    reasons.push("Safe command/code execution and terminal/file workflows fit Sandbox.");
  }
  if (input.needsCustomRuntime || input.needsLongRunningServer || /container|docker|server|postgres|redis|native|linux|gpu|binary/.test(goal)) {
    primary = "containers";
    reasons.push("Custom runtimes, existing Docker images, or heavier Linux services fit Containers.");
  }
  if (input.needsStatefulSessions || /session|websocket|stateful|per-user/.test(goal)) {
    reasons.push("Durable Objects should coordinate per-user state, sessions, and routing.");
  }
  if (reasons.length === 0) reasons.push("Start with Workers because the goal sounds edge-native and request/response oriented.");
  return {
    goal: input.goal ?? "",
    primary,
    reasons,
    availableInThisRuntime: {
      workerApiToken: Boolean(env.OPEN_THINK_CF_API_TOKEN),
      sandboxBound: skills.currentRuntime.sandboxBound,
      containerBound: skills.currentRuntime.containerBound
    },
    nextSteps: builderNextSteps(primary),
    permissionNotes: permissionNotesFor(primary),
    recommendation: platformRecommendation(primary),
    skills
  };
}

function platformRecommendation(primary) {
  if (primary === "pages") return "Use Pages for the frontend and Workers for APIs/auth/background triggers.";
  if (primary === "sandbox") return "Use Sandbox SDK when the product needs safe code execution, command runs, terminals, previews, or agent-generated code workflows.";
  if (primary === "containers") return "Use Containers directly when the product needs a custom image, full Linux service, or heavier CPU/memory/disk than Workers.";
  return "Use Workers first, then add Durable Objects, D1, R2, Queues, Vectorize, Workflows, Access, Sandbox, or Containers as requirements demand.";
}

function builderNextSteps(primary) {
  if (primary === "pages") {
    return [
      "Generate frontend app and optional Worker/Functions API.",
      "Create or update a Pages project.",
      "Attach custom domain/DNS and Access if private.",
      "Store app config in Worker/Pages env vars and secrets."
    ];
  }
  if (primary === "sandbox") {
    return [
      "Confirm Workers Paid plan and Containers/Sandbox availability.",
      "Add Sandbox binding and endpoints for exec, files, terminal, previews, and lifecycle.",
      "Persist artifacts in R2 and metadata in D1.",
      "Require confirmation for expensive or destructive commands."
    ];
  }
  if (primary === "containers") {
    return [
      "Confirm Workers Paid plan and Containers permission.",
      "Add Dockerfile, Container class, container binding, Durable Object migration, instance type, and max_instances.",
      "Route requests to getContainer with tenant/session IDs.",
      "Protect public endpoints with Access and document scale-to-zero behavior."
    ];
  }
  return [
    "Generate Worker code and wrangler bindings.",
    "Add D1/R2/KV/Queues/Vectorize/AI Gateway only as required.",
    "Deploy through the platform update path or Workers Scripts API.",
    "Verify /health, route/domain, Access, rollback, and logs."
  ];
}

function permissionNotesFor(primary) {
  const common = ["Workers Scripts Edit", "Account Settings Read", "Access Apps and Policies Edit when public/private routes need protection"];
  if (primary === "pages") return [...common, "Cloudflare Pages Edit", "DNS Edit and Workers Routes Edit for custom domains"];
  if (primary === "sandbox") return [...common, "Artifacts Edit", "Containers Edit or Cloudchamber Edit", "Workers R2 Storage Edit for artifacts", "D1 Edit for session metadata"];
  if (primary === "containers") return [...common, "Artifacts Edit when source/workspace sync is needed", "Containers Edit or Cloudchamber Edit", "Workers R2 Storage Edit for artifacts or mounted buckets"];
  return [...common, "D1/R2/KV/Queues/Vectorize/AI Gateway depending on chosen bindings"];
}

function workspaceStatus(env) {
  const artifactsRemote = env.OPEN_THINK_ARTIFACTS_REMOTE || null;
  const artifactsRepo = env.OPEN_THINK_ARTIFACTS_REPO || null;
  const artifactsNamespace = env.OPEN_THINK_ARTIFACTS_NAMESPACE || null;
  const sandboxStatus = env.OPEN_THINK_SANDBOX_STATUS || (env.Sandbox || env.SANDBOX ? "bound" : "not-configured");
  const containerStatus = env.OPEN_THINK_CONTAINER_STATUS || (env.AgentContainer || env.CONTAINER ? "bound" : "not-configured");
  return {
    mode: env.OPEN_THINK_WORKSPACE_MODE || (artifactsRemote ? "artifacts-sandbox-workspace" : "basic-github-updates"),
    basicGithubUpdates: {
      available: true,
      repository: env.OPEN_THINK_UPDATE_REPOSITORY || "NeoFlux-Holdings/OpenThink",
      branch: env.OPEN_THINK_UPDATE_BRANCH || "main",
      note: "Works on Free or Paid accounts when a Cloudflare API token can update this Worker."
    },
    artifacts: {
      configured: Boolean(artifactsRemote && artifactsRepo && artifactsNamespace),
      namespace: artifactsNamespace,
      repo: artifactsRepo,
      remote: artifactsRemote,
      tokenSecretAvailable: Boolean(env.OPEN_THINK_ARTIFACTS_TOKEN),
      requiresPaidPlan: true,
      note: artifactsRemote
        ? "Use this Git workspace for agent-authored code changes, diffs, and PR preparation."
        : "Optional upgrade. Add later from the platform when the account has Artifacts access."
    },
    sandbox: {
      status: sandboxStatus,
      requiresPaidPlan: true,
      note: "Use Sandbox for untrusted command/code execution, tests, terminal sessions, and generated app previews."
    },
    containers: {
      status: containerStatus,
      requiresPaidPlan: true,
      note: "Use Containers for custom Docker images, long-running services, heavier workloads, or runtimes Sandbox does not cover."
    }
  };
}

async function runtimeSnapshot(env) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env) || null;
  const personalAgent = await personalAgentRuntimeState(env);
  return {
    runtimeAwarenessVersion,
    deploymentId,
    starterTemplate,
    agentName,
    owner,
    scriptName: currentScript,
    accountId,
    spendLimitUsd,
    model: {
      defaultModel: env.OPEN_THINK_DEFAULT_MODEL || defaultModel,
      provider: env.OPEN_THINK_MODEL_PROVIDER || modelProvider,
      thinkingLevel: env.OPEN_THINK_THINKING_LEVEL || thinkingLevel,
      byok: {
        openrouter: Boolean(env.OPENROUTER_API_KEY),
        anthropic: Boolean(env.ANTHROPIC_API_KEY),
        openai: Boolean(env.OPENAI_API_KEY)
      }
    },
    personalAgent,
    cloudAgentInstance: cloudAgentInstanceState(env),
    subAgents: subAgentCapabilityState(env),
    slashCommands: {
      goal: goalCommandPayload("", env)
    },
    bindings: bindingStatus(env),
    storage: {
      d1MemoryTable: env.DB ? "memories" : null,
      d1ConversationTables: env.DB ? ["projects", "chat_threads", "chat_messages"] : [],
      r2Binding: env.AGENT_STORAGE ? "AGENT_STORAGE" : null,
      queueBinding: env.TASK_QUEUE ? "TASK_QUEUE" : null,
      vectorizeBinding: env.VECTORIZE ? "VECTORIZE" : null
    },
    tools: {
      builtIn: ["runtime_status", "memory_list", "set_active_goal", "create_sub_agent", "sub_agent_control", "sub_agent_message", "sub_agent_summary", "files_list", "queue_task", "secret_put", "binding_add", "update_status", "cloudflare_platform_advice", "mcp_call"],
      mcp: {
        cloudflare: {
          serverUrl: "https://mcp.cloudflare.com/mcp",
          tools: ["search", "execute"],
          runtimeSecretAvailable: Boolean(env.OPEN_THINK_CF_API_TOKEN)
        },
        executor: executorMcpServerStatus(env),
        docs: "https://docs.mcp.cloudflare.com/mcp"
      }
    },
    skills: cloudflarePlatformSkills(env),
    workspace: workspaceStatus(env),
    sourceUpdate: {
      platformUpdateApi: "/api/deployment/update on the open-think platform",
      githubUpstream: "Default update lane: check NeoFlux-Holdings/OpenThink, regenerate this Worker, upload with keep_bindings.",
      artifactSync: "Optional self-edit lane: Cloudflare Artifacts Git workspace plus Sandbox/Containers when enabled.",
      remoteRepository: env.OPEN_THINK_UPDATE_REPOSITORY || "NeoFlux-Holdings/OpenThink",
      remoteBranch: env.OPEN_THINK_UPDATE_BRANCH || "main",
      remoteBundlePath: env.OPEN_THINK_UPDATE_BUNDLE_PATH || "dist/worker.js",
      remoteStatusEndpoint: "/updates/remote",
      runtimeStatusEndpoint: "/updates/status",
      runtimeApplyEndpoint: "/updates/apply",
      runtimeBindingsEndpoint: "/updates/bindings",
      reset: {
        platformAction: "POST /api/deployment/update with action reset",
        confirmation: "Type RESET " + deploymentId,
        sourceRestore: "Reupload generated Worker from GitHub upstream while preserving current workspace metadata and encrypted secrets.",
        factorySettings: "Reupload upstream source, disable auto updates, remove workspace metadata/custom non-secret bindings, restore Kimi K2.6 Workers AI defaults, and preserve encrypted Worker secrets."
      },
      configuredBundleUrl: env.OPEN_THINK_UPDATE_BUNDLE_URL ? "OPEN_THINK_UPDATE_BUNDLE_URL is set" : null,
      directWorkerUpload: accountId && currentScript
        ? "/accounts/" + accountId + "/workers/scripts/" + currentScript
        : null,
      preserveSecrets: "Use Worker upload metadata keep_bindings ['secret_text','secret_key'] with bindings_inherit=strict.",
      bindingPatchApi: accountId && currentScript
        ? "/accounts/" + accountId + "/workers/scripts/" + currentScript + "/settings"
        : null,
      playbook: [
        "Prefer managed remote updates for upstream open-think changes.",
        "Use reset only after explicit owner confirmation; factory reset preserves secrets but removes custom non-secret Worker settings.",
        "Use the Artifacts workspace for agent-authored code changes when OPEN_THINK_ARTIFACTS_REMOTE is configured.",
        "If Artifacts/Sandbox are not configured, explain that the account can keep basic GitHub updates now and add the self-evolving workspace later.",
        "Use direct bundle updates only for a verified worker.js artifact.",
        "For local agent changes, save memory/files/secrets first, compare remote status, then rebase/reconcile before replacing code.",
        "Secrets are preserved by keep_bindings and are never readable after storage."
      ],
      canReadSecretValues: false,
      warning: "Updating the currently executing Worker can interrupt this conversation; use platform update orchestration when possible. Binding changes create a new Worker version through the settings API."
    },
    endpoints
  };
}

async function memoryList(env, limit = 20) {
  if (!env.DB) return { available: false, memories: [], error: "D1 binding is not configured." };
  await ensureMemoryTable(env);
  const boundedLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 20, 50));
  const rows = await env.DB.prepare(
    "select id, text, created_at from memories order by created_at desc limit ?"
  ).bind(boundedLimit).all();
  return {
    available: true,
    table: "memories",
    count: rows.results?.length ?? 0,
    memories: rows.results ?? []
  };
}

async function filesList(env, limit = 50) {
  if (!env.AGENT_STORAGE) {
    return { available: false, files: [], error: "R2 binding is not configured." };
  }
  const boundedLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 100));
  const list = await env.AGENT_STORAGE.list({ limit: boundedLimit });
  return {
    available: true,
    binding: "AGENT_STORAGE",
    files: list.objects.map((item) => ({ key: item.key, size: item.size, uploaded: item.uploaded }))
  };
}

async function queueTask(env, input) {
  if (!env.TASK_QUEUE) {
    return { queued: false, error: "Queue binding is not configured." };
  }
  const payload = input.payload ?? { text: String(input.text ?? "").trim() };
  await env.TASK_QUEUE.send({
    deploymentId,
    agentName,
    payload,
    queuedAt: new Date().toISOString()
  });
  return { queued: true, binding: "TASK_QUEUE", payload };
}

async function setActiveGoal(env, input) {
  const normalized = {
    goal: String(input.goal ?? "").trim(),
    successCriteria: normalizeStringList(input.successCriteria),
    milestones: normalizeStringList(input.milestones),
    nextActions: normalizeStringList(input.nextActions),
    notes: String(input.notes ?? "").trim()
  };
  if (!normalized.goal) {
    return { stored: false, error: "Goal is required." };
  }

  const text = formatActiveGoalMemory(normalized);
  if (!env.DB) {
    return {
      stored: false,
      goal: normalized.goal,
      memory: text,
      error: "D1 DB binding is not configured; goal remains in conversation state."
    };
  }

  await ensureMemoryTable(env);
  const storedAt = new Date().toISOString();
  await env.DB.prepare("insert into memories (id, text, created_at) values (?, ?, ?)")
    .bind(crypto.randomUUID(), text, storedAt)
    .run();
  return {
    stored: true,
    table: "memories",
    goal: normalized.goal,
    memory: text,
    storedAt
  };
}

function formatActiveGoalMemory(input) {
  const lines = [
    "Active goal: " + input.goal,
    listSection("Success criteria", input.successCriteria),
    listSection("Milestones", input.milestones),
    listSection("Next actions", input.nextActions),
    input.notes ? "Notes: " + input.notes : ""
  ].filter(Boolean);
  return lines.join("\\n");
}

function listSection(label, values) {
  const items = normalizeStringList(values);
  if (items.length === 0) return "";
  return label + ": " + items.join("; ");
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

async function handleSubAgentsList(env) {
  if (!env.DB) {
    return Response.json({ available: false, subAgents: [], error: "D1 binding is not configured." });
  }
  return Response.json({ available: true, subAgents: await listSubAgents(env) });
}

async function handleSubAgentCreate(request, env) {
  const result = await createSubAgent(env, await request.json().catch(() => ({})));
  return Response.json(result, { status: result.ok === false ? 400 : 201 });
}

function parseSubAgentRoute(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "subagents" || !parts[1] || parts.length > 3) return null;
  return {
    id: decodeURIComponent(parts[1]),
    action: parts[2] || "detail"
  };
}

async function handleSubAgentRoute(request, env, route) {
  if (route.action === "detail" && request.method === "GET") {
    const subAgent = await getSubAgent(env, route.id);
    if (!subAgent) return Response.json({ error: "Sub-agent not found." }, { status: 404 });
    return Response.json({ subAgent });
  }

  if (route.action === "messages" && request.method === "GET") {
    const subAgent = await getSubAgent(env, route.id);
    if (!subAgent) return Response.json({ error: "Sub-agent not found." }, { status: 404 });
    return Response.json({ subAgent, messages: await listSubAgentMessages(env, route.id) });
  }

  if (route.action === "messages" && request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const result = await sendSubAgentMessage(env, route.id, String(payload.message ?? payload.text ?? ""));
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  if (route.action === "control" && request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const result = await updateSubAgentStatus(env, route.id, normalizeSubAgentStatus(payload.status ?? payload.action, "ready"));
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  if (route.action === "summary" && request.method === "POST") {
    const result = await refreshSubAgentSummary(env, route.id);
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  return Response.json({ error: "Unsupported sub-agent route." }, { status: 404 });
}

async function ensureSubAgentTables(env) {
  if (!env.DB) return false;
  await env.DB.prepare(
    "create table if not exists sub_agents (id text primary key, name text not null, purpose text not null, status text not null, mode text not null, model text not null, brain text not null, system_prompt text not null, skills_json text not null, summary text not null, created_at text not null, updated_at text not null)"
  ).run();
  await env.DB.prepare(
    "create table if not exists sub_agent_messages (id text primary key, sub_agent_id text not null, role text not null, content text not null, created_at text not null)"
  ).run();
  return true;
}

async function createSubAgent(env, input) {
  if (!(await ensureSubAgentTables(env))) return { ok: false, error: "D1 binding is not configured." };
  const now = new Date().toISOString();
  const id = "subagent-" + crypto.randomUUID();
  const name = normalizeShortText(input.name, "Research Agent");
  const purpose = normalizeLongText(input.purpose, "Help the main personal agent investigate and advance a delegated objective.");
  const brain = normalizeShortText(input.brain, "gbrain + gskills");
  const mode = normalizeSubAgentMode(input.mode);
  const skills = normalizeStringArray(input.skills);
  const model = normalizeShortText(input.model, String(env.OPEN_THINK_DEFAULT_MODEL || defaultModel));
  const systemPrompt = normalizeLongText(input.systemPrompt, defaultSubAgentSystemPrompt(name, purpose, brain, skills, mode));
  const summary = "Ready. " + purpose;

  await env.DB.prepare(
    "insert into sub_agents (id, name, purpose, status, mode, model, brain, system_prompt, skills_json, summary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, name, purpose, "ready", mode, model, brain, systemPrompt, JSON.stringify(skills), summary, now, now)
    .run();

  return { ok: true, subAgent: await getSubAgent(env, id) };
}

async function listSubAgents(env) {
  if (!(await ensureSubAgentTables(env))) return [];
  const rows = await env.DB.prepare(
    "select a.*, (select count(*) from sub_agent_messages m where m.sub_agent_id = a.id) as message_count from sub_agents a order by datetime(a.updated_at) desc limit 100"
  ).all();
  return (rows.results || []).map(rowToSubAgent);
}

async function getSubAgent(env, id) {
  if (!id || !(await ensureSubAgentTables(env))) return null;
  const row = await env.DB.prepare(
    "select a.*, (select count(*) from sub_agent_messages m where m.sub_agent_id = a.id) as message_count from sub_agents a where a.id = ? limit 1"
  ).bind(id).first();
  return row ? rowToSubAgent(row) : null;
}

async function listSubAgentMessages(env, id) {
  if (!(await ensureSubAgentTables(env))) return [];
  const rows = await env.DB.prepare(
    "select id, sub_agent_id, role, content, created_at from sub_agent_messages where sub_agent_id = ? order by datetime(created_at) asc limit 80"
  ).bind(id).all();
  return (rows.results || []).map(rowToSubAgentMessage);
}

async function updateSubAgentStatus(env, id, status) {
  const subAgent = await getSubAgent(env, id);
  if (!subAgent) return { ok: false, error: "Sub-agent not found." };
  const now = new Date().toISOString();
  await env.DB.prepare("update sub_agents set status = ?, updated_at = ? where id = ?")
    .bind(status, now, id)
    .run();
  return { ok: true, subAgent: await getSubAgent(env, id) };
}

async function sendSubAgentMessage(env, id, rawMessage) {
  const subAgent = await getSubAgent(env, id);
  if (!subAgent) return { ok: false, error: "Sub-agent not found." };
  if (subAgent.status === "archived") return { ok: false, error: "Archived sub-agents cannot receive new messages." };
  if (subAgent.status === "paused") return { ok: false, error: "Paused sub-agents must be resumed before receiving messages." };
  const message = String(rawMessage || "").trim();
  if (!message) return { ok: false, error: "Message is required." };

  await setSubAgentStatusOnly(env, id, "working");
  const now = new Date().toISOString();
  await env.DB.prepare(
    "insert into sub_agent_messages (id, sub_agent_id, role, content, created_at) values (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), id, "user", message, now).run();

  const history = await listSubAgentMessages(env, id);
  const reply = await runSubAgentModel(env, subAgent, history);
  const repliedAt = new Date().toISOString();
  await env.DB.prepare(
    "insert into sub_agent_messages (id, sub_agent_id, role, content, created_at) values (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), id, "assistant", reply, repliedAt).run();
  await env.DB.prepare("update sub_agents set status = ?, summary = ?, updated_at = ? where id = ?")
    .bind("ready", deriveSubAgentSummary(subAgent, message, reply), repliedAt, id)
    .run();

  return { ok: true, subAgent: await getSubAgent(env, id), message: reply, messages: await listSubAgentMessages(env, id) };
}

async function refreshSubAgentSummary(env, id) {
  const subAgent = await getSubAgent(env, id);
  if (!subAgent) return { ok: false, error: "Sub-agent not found." };
  const messages = await listSubAgentMessages(env, id);
  const summary = await summarizeSubAgentMessages(env, subAgent, messages);
  const now = new Date().toISOString();
  await env.DB.prepare("update sub_agents set summary = ?, updated_at = ? where id = ?")
    .bind(summary, now, id)
    .run();
  return { ok: true, summary, subAgent: await getSubAgent(env, id) };
}

async function setSubAgentStatusOnly(env, id, status) {
  await env.DB.prepare("update sub_agents set status = ?, updated_at = ? where id = ?")
    .bind(status, new Date().toISOString(), id)
    .run();
}

async function runSubAgentModel(env, subAgent, history) {
  if (!env.AI) return "I am configured as " + subAgent.name + ", but the Workers AI binding is not available for sub-agent responses.";
  const modelSettings = { ...resolveModelSettings(env), model: subAgent.model || resolveModelSettings(env).model };
  const transcript = history.slice(-12).map((message) => message.role.toUpperCase() + ": " + message.content).join("\\n\\n");
  const output = await runModel(env, modelSettings, [
    { role: "system", content: subAgentSystemInstruction(subAgent, env) },
    {
      role: "user",
      content: ["Conversation so far:", transcript || "No prior messages.", "", "Respond as the sub-agent. Be concise, concrete, and include next action if useful."].join("\\n")
    }
  ]);
  return normalizeModelOutput(output).trim() || "No response generated.";
}

async function summarizeSubAgentMessages(env, subAgent, messages) {
  if (!env.AI || messages.length === 0) return deriveSubAgentSummary(subAgent);
  const modelSettings = { ...resolveModelSettings(env), model: subAgent.model || resolveModelSettings(env).model };
  const transcript = messages.slice(-20).map((message) => message.role.toUpperCase() + ": " + message.content).join("\\n\\n");
  const output = await runModel(env, modelSettings, [
    { role: "system", content: "Summarize this sub-agent state for an operator dashboard in two compact sentences." },
    { role: "user", content: transcript }
  ]);
  return normalizeModelOutput(output).trim() || deriveSubAgentSummary(subAgent);
}

function subAgentSystemInstruction(subAgent, env) {
  return [
    subAgent.systemPrompt,
    "You are a child Cloud Agent Instance coordinated by the main OpenThink personal agent.",
    "Brain: " + subAgent.brain + ". Mode: " + subAgent.mode + ". Skills: " + (subAgent.skills.join(", ") || "none") + ".",
    "Use Agents SDK semantics for chat/state. Use executor-oriented reasoning only when the main runtime exposes OPEN_THINK_EXECUTOR_MCP_URL.",
    sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL)
      ? "Executor MCP is configured for execution-heavy work."
      : "Executor MCP is not configured; plan execution but do not claim external executor access."
  ].join("\\n");
}

function defaultSubAgentSystemPrompt(name, purpose, brain, skills, mode) {
  return [
    "You are " + name + ", a scoped Cloud Agent Instance sub-agent.",
    "Purpose: " + purpose,
    "Use the " + brain + " brain profile with " + (skills.join(", ") || "general reasoning") + ".",
    "Mode: " + mode + ". Keep work bounded, report blockers, and hand concise summaries back to the main personal agent."
  ].join("\\n");
}

function deriveSubAgentSummary(subAgent, lastUser, lastReply) {
  if (lastUser && lastReply) return "Last task: " + compactText(lastUser, 90) + " Response: " + compactText(lastReply, 140);
  return subAgent.summary || "Ready. " + subAgent.purpose;
}

function rowToSubAgent(row) {
  return {
    id: String(row.id || ""),
    name: String(row.name || "Sub-agent"),
    purpose: String(row.purpose || ""),
    status: normalizeSubAgentStatus(row.status, "ready"),
    mode: normalizeSubAgentMode(row.mode),
    model: String(row.model || defaultModel),
    brain: String(row.brain || "gbrain + gskills"),
    systemPrompt: String(row.system_prompt || ""),
    skills: parseJsonArray(row.skills_json),
    summary: String(row.summary || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    messageCount: Number(row.message_count || 0)
  };
}

function rowToSubAgentMessage(row) {
  const role = String(row.role || "assistant");
  return {
    id: String(row.id || ""),
    subAgentId: String(row.sub_agent_id || ""),
    role: role === "user" || role === "system" ? role : "assistant",
    content: String(row.content || ""),
    createdAt: String(row.created_at || "")
  };
}

function normalizeShortText(value, fallback) {
  const text = String(value ?? "").trim();
  return compactText(text || fallback, 96);
}

function normalizeLongText(value, fallback) {
  const text = String(value ?? "").trim();
  return compactText(text || fallback, 2000);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeShortText(item, "")).filter(Boolean).slice(0, 12);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => normalizeShortText(item, "")).filter(Boolean).slice(0, 12);
  return [];
}

function normalizeSubAgentMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "agents-sdk" || mode === "executor" || mode === "hybrid") return mode;
  return "hybrid";
}

function normalizeSubAgentStatus(value, fallback) {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "pause") return "paused";
  if (status === "resume") return "ready";
  if (status === "start") return "working";
  if (status === "archive") return "archived";
  if (status === "ready" || status === "working" || status === "paused" || status === "archived") return status;
  return fallback;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return normalizeStringArray(value);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return normalizeStringArray(JSON.parse(value));
  } catch {
    return normalizeStringArray(value);
  }
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

async function handleSecretsList(env) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env);
  if (!env.OPEN_THINK_CF_API_TOKEN || !accountId || !currentScript) {
    return Response.json({
      secrets: [],
      error: "Cloudflare API token, account id, and script name are required for secret management."
    });
  }
  const result = await cloudflareApi(env, "/accounts/" + accountId + "/workers/scripts/" + currentScript + "/secrets", { method: "GET" });
  return Response.json({ secrets: Array.isArray(result) ? result : result?.secrets ?? result ?? [] });
}

async function handleSecretPut(request, env) {
  const result = await putWorkerSecret(env, await request.json().catch(() => ({})));
  return Response.json(result, { status: result.ok === false ? 400 : 200 });
}

async function handleSecretDelete(url, env) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env);
  const name = sanitizeSecretName(url.searchParams.get("name"));
  if (!env.OPEN_THINK_CF_API_TOKEN || !accountId || !currentScript) {
    return Response.json({ error: "Cloudflare API token, account id, and script name are required." }, { status: 503 });
  }
  if (!name) return Response.json({ error: "Secret name is required." }, { status: 400 });
  const result = await cloudflareApi(env, "/accounts/" + accountId + "/workers/scripts/" + currentScript + "/secrets/" + name, { method: "DELETE" });
  return Response.json({ name, deleted: true, result });
}

async function handleUpdateStatus(env) {
  return Response.json(await updateStatusPayload(env));
}

async function handleRemoteUpdateStatus(env) {
  return Response.json(await remoteUpdateStatusPayload(env));
}

async function updateStatusPayload(env) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env);
  const base = {
    deploymentId,
    agentName,
    accountId,
    scriptName: currentScript || null,
    apiTokenAvailable: Boolean(env.OPEN_THINK_CF_API_TOKEN),
    configuredBundleUrl: Boolean(env.OPEN_THINK_UPDATE_BUNDLE_URL),
    workspace: workspaceStatus(env),
    remote: remoteUpdateConfig(env),
    platformUpdate: {
      mode: "platform-orchestrated",
      endpoint: "/api/deployment/update on the open-think platform",
      needs: "The platform must know this deployment record and have an update-capable Cloudflare token or a freshly pasted token."
    },
    runtimeUpdate: {
      mode: "direct-worker-api",
      statusEndpoint: "/updates/status",
      applyEndpoint: "/updates/apply",
      bindingsEndpoint: "/updates/bindings",
      preservesSecrets: true,
      warning: "A direct update replaces the currently executing Worker and can interrupt the active request."
    }
  };

  if (!env.OPEN_THINK_CF_API_TOKEN || !accountId || !currentScript) {
    return {
      ...base,
      ready: false,
      error: "Cloudflare API token, account id, and script name are required for runtime updates."
    };
  }

  const settings = await getWorkerSettings(env);
  return {
    ...base,
    ready: settings?.ok !== false,
    settings,
    bindings: Array.isArray(settings?.bindings) ? settings.bindings.map(describeBinding) : []
  };
}

async function remoteUpdateStatusPayload(env) {
  const config = remoteUpdateConfig(env);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "open-think-agent-update-check"
  };
  if (env.OPEN_THINK_GITHUB_TOKEN) {
    headers.Authorization = "Bearer " + env.OPEN_THINK_GITHUB_TOKEN;
  }

  const result = {
    ...config,
    authenticated: Boolean(env.OPEN_THINK_GITHUB_TOKEN),
    currentSha: env.OPEN_THINK_SOURCE_SHA || null,
    updateAvailable: null,
    remoteSha: null,
    remoteUrl: "https://github.com/" + config.repository,
    bundleUrl: githubRawBundleUrl(config),
    checkedAt: new Date().toISOString()
  };

  try {
    const response = await fetch("https://api.github.com/repos/" + config.repository + "/commits/" + encodeURIComponent(config.branch), { headers });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ...result,
        ok: false,
        error: body?.message || "GitHub remote check failed with " + response.status + ". Private repositories need OPEN_THINK_GITHUB_TOKEN."
      };
    }
    const remoteSha = body?.sha || null;
    return {
      ...result,
      ok: true,
      remoteSha,
      updateAvailable: Boolean(result.currentSha && remoteSha && result.currentSha !== remoteSha),
      message: result.currentSha
        ? remoteSha === result.currentSha
          ? "Remote branch matches this deployed source SHA."
          : "Remote branch differs from this deployed source SHA."
        : "Remote branch is reachable. Store OPEN_THINK_SOURCE_SHA during deploys to enable exact update comparison."
    };
  } catch (error) {
    return {
      ...result,
      ok: false,
      error: error instanceof Error ? error.message : "GitHub remote check failed."
    };
  }
}

async function handleUpdateApply(request, env) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env);
  if (!env.OPEN_THINK_CF_API_TOKEN || !accountId || !currentScript) {
    return Response.json({ error: "Cloudflare API token, account id, and script name are required." }, { status: 503 });
  }

  const payload = await request.json().catch(() => ({}));
  const moduleCode = await resolveUpdateModuleCode(payload, env);
  if (!moduleCode) {
    return Response.json({
      error: "Provide moduleCode, moduleUrl, or set OPEN_THINK_UPDATE_BUNDLE_URL as a Worker secret."
    }, { status: 400 });
  }

  const settings = await getWorkerSettings(env);
  if (settings?.ok === false) {
    return Response.json({ error: settings.error || "Could not read current Worker settings.", cloudflare: settings }, { status: 502 });
  }

  const metadata = workerUploadMetadataFromSettings(settings);
  const result = await uploadWorkerModuleFromRuntime(env, currentScript, moduleCode, metadata);
  return Response.json({
    updated: result?.ok !== false,
    deploymentId,
    scriptName: currentScript,
    uploadedAt: new Date().toISOString(),
    metadata: {
      main_module: metadata.main_module,
      compatibility_date: metadata.compatibility_date,
      compatibility_flags: metadata.compatibility_flags,
      bindings: metadata.bindings.map(describeBinding),
      keep_bindings: metadata.keep_bindings
    },
    result
  });
}

async function resolveUpdateModuleCode(payload, env) {
  const inlineCode = String(payload.moduleCode ?? payload.code ?? "").trim();
  if (inlineCode) return inlineCode;

  const sourceUrl = String(payload.moduleUrl ?? payload.url ?? env.OPEN_THINK_UPDATE_BUNDLE_URL ?? "").trim();
  if (!sourceUrl) return "";
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  const response = await fetch(parsed.toString(), {
    headers: env.OPEN_THINK_UPDATE_BUNDLE_TOKEN
      ? { Authorization: "Bearer " + env.OPEN_THINK_UPDATE_BUNDLE_TOKEN }
      : {}
  });
  if (!response.ok) return "";
  return response.text();
}

async function handleBindingsList(env) {
  const settings = await getWorkerSettings(env);
  if (settings?.ok === false) {
    return Response.json({ error: settings.error || "Could not read Worker settings.", cloudflare: settings }, { status: 502 });
  }
  return Response.json({
    bindings: Array.isArray(settings?.bindings) ? settings.bindings.map(describeBinding) : [],
    compatibility_date: settings?.compatibility_date ?? null,
    compatibility_flags: settings?.compatibility_flags ?? []
  });
}

async function handleBindingPatch(request, env) {
  const result = await patchWorkerBinding(env, await request.json().catch(() => ({})));
  return Response.json(result, { status: result.ok === false ? 400 : 200 });
}

async function putWorkerSecret(env, input) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env);
  const name = sanitizeSecretName(input.name);
  const text = String(input.value ?? input.text ?? "");
  if (!env.OPEN_THINK_CF_API_TOKEN || !accountId || !currentScript) {
    return { ok: false, error: "Cloudflare API token, account id, and script name are required." };
  }
  if (!name) return { ok: false, error: "Secret name must be uppercase letters, numbers, or underscore." };
  if (!text) return { ok: false, error: "Secret value is required." };
  const result = await cloudflareApi(env, "/accounts/" + accountId + "/workers/scripts/" + currentScript + "/secrets", {
    method: "PUT",
    body: JSON.stringify({ name, text, type: "secret_text" })
  });
  return { ok: result?.ok !== false, name, updated: result?.ok !== false, result };
}

async function patchWorkerBinding(env, input) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env);
  if (!env.OPEN_THINK_CF_API_TOKEN || !accountId || !currentScript) {
    return { ok: false, error: "Cloudflare API token, account id, and script name are required." };
  }

  const binding = normalizeWorkerBinding(input);
  if (binding?.type === "secret_text") {
    return putWorkerSecret(env, input);
  }
  if (!binding) {
    return { ok: false, error: "Unsupported or incomplete binding. Secrets should use /secrets or secret_put." };
  }

  const settings = await getWorkerSettings(env);
  if (settings?.ok === false) return settings;
  const currentBindings = Array.isArray(settings?.bindings) ? settings.bindings : [];
  const nextBindings = [
    ...currentBindings
      .filter((item) => item?.name && item.name !== binding.name)
      .map((item) => ({ type: "inherit", name: item.name })),
    binding
  ];
  const result = await cloudflareApi(env, "/accounts/" + accountId + "/workers/scripts/" + currentScript + "/settings", {
    method: "PATCH",
    body: JSON.stringify({
      bindings: nextBindings,
      compatibility_date: settings?.compatibility_date || "2026-05-01",
      compatibility_flags: settings?.compatibility_flags || []
    })
  });
  return {
    ok: result?.ok !== false,
    binding: describeBinding(binding),
    result
  };
}

async function getWorkerSettings(env) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env);
  if (!env.OPEN_THINK_CF_API_TOKEN || !accountId || !currentScript) {
    return { ok: false, error: "Cloudflare API token, account id, and script name are required." };
  }
  return cloudflareApi(env, "/accounts/" + accountId + "/workers/scripts/" + currentScript + "/settings", { method: "GET" });
}

async function uploadWorkerModuleFromRuntime(env, currentScript, moduleCode, metadata) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const form = new FormData();
  form.set("metadata", JSON.stringify(metadata));
  form.set("worker.js", new Blob([moduleCode], { type: "application/javascript+module" }), "worker.js");
  const uploadUrl = new URL("https://api.cloudflare.com/client/v4/accounts/" + accountId + "/workers/scripts/" + currentScript);
  uploadUrl.searchParams.set("bindings_inherit", "strict");
  const response = await fetch(uploadUrl.toString(), {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + env.OPEN_THINK_CF_API_TOKEN
    },
    body: form
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    return {
      ok: false,
      status: response.status,
      error: body?.errors?.[0]?.message ?? "Worker upload failed.",
      cloudflare: body
    };
  }
  return body?.result ?? body;
}

function workerUploadMetadataFromSettings(settings) {
  return {
    main_module: "worker.js",
    compatibility_date: settings?.compatibility_date || "2026-05-01",
    compatibility_flags: Array.isArray(settings?.compatibility_flags) ? settings.compatibility_flags : ["nodejs_compat", "global_fetch_strictly_public"],
    bindings: Array.isArray(settings?.bindings)
      ? settings.bindings.filter((binding) => binding?.type !== "secret_text" && binding?.type !== "secret_key")
      : [],
    keep_bindings: ["secret_text", "secret_key"]
  };
}

function normalizeWorkerBinding(input) {
  const type = String(input.type ?? "").trim();
  const name = sanitizeBindingName(input.name);
  if (!type || !name) return null;
  if (type === "plain_text") {
    const text = String(input.text ?? input.value ?? "");
    if (!text) return null;
    return { type, name, text };
  }
  if (type === "secret_text") return { type, name };
  if (type === "r2_bucket") {
    const bucketName = String(input.bucket_name ?? input.bucketName ?? input.resourceName ?? "").trim();
    return bucketName ? { type, name, bucket_name: bucketName } : null;
  }
  if (type === "d1") {
    const id = String(input.id ?? input.database_id ?? input.databaseId ?? "").trim();
    return id ? { type, name, id } : null;
  }
  if (type === "queue") {
    const queueName = String(input.queue_name ?? input.queueName ?? input.resourceName ?? "").trim();
    return queueName ? { type, name, queue_name: queueName } : null;
  }
  if (type === "vectorize") {
    const indexName = String(input.index_name ?? input.indexName ?? input.resourceName ?? "").trim();
    return indexName ? { type, name, index_name: indexName } : null;
  }
  if (type === "kv_namespace") {
    const namespaceId = String(input.namespace_id ?? input.namespaceId ?? input.id ?? "").trim();
    return namespaceId ? { type, name, namespace_id: namespaceId } : null;
  }
  if (type === "service") {
    const service = String(input.service ?? input.serviceName ?? "").trim();
    return service ? { type, name, service } : null;
  }
  return null;
}

function remoteUpdateConfig(env) {
  return {
    repository: String(env.OPEN_THINK_UPDATE_REPOSITORY || "NeoFlux-Holdings/OpenThink"),
    branch: String(env.OPEN_THINK_UPDATE_BRANCH || "main"),
    bundlePath: String(env.OPEN_THINK_UPDATE_BUNDLE_PATH || "dist/worker.js")
  };
}

function githubRawBundleUrl(config) {
  return "https://raw.githubusercontent.com/" + config.repository + "/" + encodeURIComponent(config.branch) + "/" + config.bundlePath.split("/").map(encodeURIComponent).join("/");
}

function describeBinding(binding) {
  if (!binding || typeof binding !== "object") return binding;
  const value = bindingValue(binding);
  const encrypted = binding.type === "secret_text" || binding.type === "secret_key";
  return {
    ...binding,
    value: encrypted ? "" : value,
    maskedValue: encrypted ? "Encrypted in Cloudflare" : value ? "Hidden" : "",
    canReveal: Boolean(value && !encrypted),
    encrypted,
    displayType: encrypted ? "encrypted secret" : binding.type || "binding"
  };
}

function bindingValue(binding) {
  return String(
    binding.text ??
    binding.bucket_name ??
    binding.id ??
    binding.queue_name ??
    binding.index_name ??
    binding.namespace_id ??
    binding.service ??
    ""
  );
}

async function handleMcpServerRegister(request, env) {
  if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
  const payload = await request.json().catch(() => ({}));
  const name = sanitizeMcpName(payload.name);
  const serverUrl = sanitizeMcpUrl(payload.url);
  if (!name) return Response.json({ error: "MCP server name is required." }, { status: 400 });
  if (!serverUrl) return Response.json({ error: "MCP server URL must be HTTPS." }, { status: 400 });

  await ensureMcpTable(env);
  const existing = await env.DB.prepare("select id from mcp_servers where name = ? or url = ? limit 1")
    .bind(name, serverUrl)
    .first();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.prepare(
    "insert or replace into mcp_servers (id, name, url, transport, state, created_at, updated_at) values (?, ?, ?, ?, ?, coalesce((select created_at from mcp_servers where id = ?), ?), ?)"
  )
    .bind(id, name, serverUrl, "streamable-http", "registered", id, new Date().toISOString(), new Date().toISOString())
    .run();
  return Response.json({ server: { id, name, url: serverUrl, transport: "streamable-http", state: "registered" } });
}

async function handleMcpServerRemove(request, env) {
  if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return Response.json({ error: "id query parameter is required." }, { status: 400 });
  await ensureMcpTable(env);
  await env.DB.prepare("delete from mcp_servers where id = ?").bind(id).run();
  return Response.json({ removed: true });
}

async function handleMcpTools(url, env) {
  const server = String(url.searchParams.get("server") ?? "cloudflare").trim();
  if (server === "cloudflare") {
    return Response.json({ server: "cloudflare", tools: cloudflareMcpTools() });
  }
  if (server === "executor") {
    const record = executorMcpServer(env);
    if (!record) {
      return Response.json({ error: "OPEN_THINK_EXECUTOR_MCP_URL is not configured." }, { status: 503 });
    }
    const result = await mcpRequest(record.url, "tools/list", {}, executorMcpHeaders(env));
    return Response.json({
      server: record,
      tools: result.result?.tools ?? [],
      raw: result
    });
  }

  const record = await getMcpServer(env, server);
  if (!record) return Response.json({ error: "MCP server not found." }, { status: 404 });
  const result = await mcpRequest(record.url, "tools/list", {});
  await markMcpServer(env, record.id, result.ok ? "ready" : "failed", result.ok ? null : result.error);
  return Response.json({
    server: record,
    tools: result.result?.tools ?? [],
    raw: result
  });
}

async function handleMcpCall(request, env) {
  const payload = await request.json().catch(() => ({}));
  const server = String(payload.server ?? "cloudflare").trim();
  const name = String(payload.name ?? "").trim();
  const args = payload.arguments ?? payload.args ?? {};
  if (!name) return Response.json({ error: "Tool name is required." }, { status: 400 });

  if (server === "cloudflare") {
    return Response.json({
      server: "cloudflare",
      tool: name,
      result: await callCloudflareMcpTool(name, args, env)
    });
  }
  if (server === "executor") {
    return Response.json({
      server: executorMcpServerStatus(env),
      tool: name,
      result: await callExecutorMcpTool(name, args, env)
    });
  }

  const record = await getMcpServer(env, server);
  if (!record) return Response.json({ error: "MCP server not found." }, { status: 404 });
  const result = await mcpRequest(record.url, "tools/call", {
    name,
    arguments: args
  });
  await markMcpServer(env, record.id, result.ok ? "ready" : "failed", result.ok ? null : result.error);
  return Response.json({ server: record, tool: name, result });
}

async function callCloudflareMcpTool(name, args, env) {
  if (name === "search") {
    return cloudflareApiSearch(String(args.query ?? args.q ?? ""));
  }

  if (name === "execute") {
    if (!env.OPEN_THINK_CF_API_TOKEN) {
      return { ok: false, error: "OPEN_THINK_CF_API_TOKEN is not configured." };
    }
    const method = String(args.method ?? "GET").toUpperCase();
    const path = String(args.path ?? "").trim();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return { ok: false, error: "Unsupported Cloudflare API method." };
    }
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
      return { ok: false, error: "Path must be a Cloudflare API path such as /accounts/{id}." };
    }
    const init = { method };
    if (args.body !== undefined && method !== "GET") {
      init.body = JSON.stringify(args.body);
    }
    return cloudflareApi(env, path, init);
  }

  return { ok: false, error: "Unknown Cloudflare MCP tool." };
}

async function callExecutorMcpTool(name, args, env) {
  const record = executorMcpServer(env);
  if (!record) {
    return { ok: false, error: "OPEN_THINK_EXECUTOR_MCP_URL is not configured." };
  }
  return mcpRequest(record.url, "tools/call", {
    name,
    arguments: args
  }, executorMcpHeaders(env));
}

function cloudflareMcpTools() {
  return [
    {
      name: "search",
      description: "Search common Cloudflare API operations available to this personal agent.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"]
      }
    },
    {
      name: "execute",
      description: "Execute a Cloudflare REST API operation with the runtime-scoped token.",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string" },
          body: { type: "object" }
        },
        required: ["method", "path"]
      }
    }
  ];
}

function cloudflareApiSearch(query) {
  const q = query.toLowerCase();
  const operations = [
    { label: "Get account", method: "GET", path: "/accounts/{account_id}", tags: ["account", "settings"] },
    { label: "List Workers scripts", method: "GET", path: "/accounts/{account_id}/workers/scripts", tags: ["workers", "scripts"] },
    { label: "Get Workers subdomain", method: "GET", path: "/accounts/{account_id}/workers/subdomain", tags: ["workers", "workers.dev"] },
    { label: "List D1 databases", method: "GET", path: "/accounts/{account_id}/d1/database", tags: ["d1", "database"] },
    { label: "List R2 buckets", method: "GET", path: "/accounts/{account_id}/r2/buckets", tags: ["r2", "storage"] },
    { label: "List Queues", method: "GET", path: "/accounts/{account_id}/queues", tags: ["queues", "tasks"] },
    { label: "List Vectorize indexes", method: "GET", path: "/accounts/{account_id}/vectorize/v2/indexes", tags: ["vectorize", "memory"] },
    { label: "List Access apps", method: "GET", path: "/accounts/{account_id}/access/apps", tags: ["access", "zero trust"] },
    { label: "List AI Gateway gateways", method: "GET", path: "/accounts/{account_id}/ai-gateway/gateways", tags: ["ai", "gateway"] }
  ];
  return {
    ok: true,
    query,
    operations: operations.filter((operation) =>
      !q ||
      operation.label.toLowerCase().includes(q) ||
      operation.path.toLowerCase().includes(q) ||
      operation.tags.some((tag) => tag.includes(q))
    )
  };
}

async function mcpRequest(serverUrl, method, params, extraHeaders = {}) {
  const id = crypto.randomUUID();
  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(extraHeaders || {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    })
  });
  const text = await response.text();
  const data = parseMcpResponse(text);
  if (!response.ok || data?.error) {
    return {
      ok: false,
      status: response.status,
      error: data?.error?.message ?? (text.slice(0, 800) || "MCP request failed.")
    };
  }
  return {
    ok: true,
    status: response.status,
    result: data?.result ?? data
  };
}

function parseMcpResponse(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const dataLine = trimmed
    .split("\\n")
    .find((line) => line.startsWith("data: "));
  return dataLine ? JSON.parse(dataLine.slice(6)) : { result: text };
}

async function cloudflareApi(env, path, init = {}) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + env.OPEN_THINK_CF_API_TOKEN,
      "Content-Type": "application/json"
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    return {
      ok: false,
      status: response.status,
      error: body?.errors?.[0]?.message ?? "Cloudflare API request failed."
    };
  }
  return body?.result ?? body;
}

function resolvePersonalAgentConfig(env) {
  const raw = env.OPEN_THINK_PERSONAL_AGENT_CONFIG;
  let parsed = generatedPersonalAgentConfig;
  if (typeof raw === "string" && raw.trim()) {
    parsed = parseJson(raw, generatedPersonalAgentConfig);
  }
  const config = parsed && typeof parsed === "object" ? parsed : generatedPersonalAgentConfig;
  const features = config.features && typeof config.features === "object" ? config.features : {};
  const enabledFeatures = Array.isArray(config.enabledFeatures)
    ? config.enabledFeatures.map(String).filter(Boolean)
    : Object.keys(features).filter((key) => Boolean(features[key]));
  const setupSteps = Array.isArray(config.setupSteps) ? config.setupSteps.map(String) : [];
  const resolved = {
    enabled: Boolean(config.enabled),
    presetId: String(config.presetId || "openthink-gbrain-gstack"),
    label: String(config.label || "OpenThink gbrain + gstack"),
    stack: String(config.stack || "gstack"),
    brain: String(config.brain || "gbrain"),
    summary: String(config.summary || "Cloudflare-native personal agent setup."),
    setupKind: String(config.setupKind || "native"),
    advancedMode: Boolean(config.advancedMode),
    features,
    enabledFeatures,
    setupSteps,
    setupStatus: String(config.setupStatus || (config.enabled ? "complete" : "disabled")),
    soulPromptConfigured: Boolean(config.enabled && (config.soulPromptConfigured || config.soulPrompt)),
    launchBriefConfigured: Boolean(config.enabled && (config.launchBriefConfigured || config.launchBrief))
  };
  if (typeof config.customName === "string" && config.customName.trim()) resolved.customName = config.customName.trim();
  if (typeof config.externalEndpoint === "string" && config.externalEndpoint.trim()) resolved.externalEndpoint = config.externalEndpoint.trim();
  if (typeof config.sourceLabel === "string" && config.sourceLabel.trim()) resolved.sourceLabel = config.sourceLabel.trim();
  if (typeof config.sourceUrl === "string" && config.sourceUrl.trim()) resolved.sourceUrl = config.sourceUrl.trim();
  if (resolved.enabled && typeof config.soulPrompt === "string" && config.soulPrompt.trim()) {
    resolved.soulPrompt = config.soulPrompt.trim();
    resolved.soulPromptConfigured = true;
  }
  if (resolved.enabled && resolved.soulPromptConfigured && typeof env.OPEN_THINK_SOUL_PROMPT === "string" && env.OPEN_THINK_SOUL_PROMPT.trim()) {
    resolved.soulPrompt = env.OPEN_THINK_SOUL_PROMPT.trim();
  }
  if (resolved.enabled && typeof config.launchBrief === "string" && config.launchBrief.trim()) {
    resolved.launchBrief = config.launchBrief.trim();
    resolved.launchBriefConfigured = true;
  }
  if (resolved.enabled && resolved.launchBriefConfigured && typeof env.OPEN_THINK_LAUNCH_BRIEF === "string" && env.OPEN_THINK_LAUNCH_BRIEF.trim()) {
    resolved.launchBrief = env.OPEN_THINK_LAUNCH_BRIEF.trim();
  }
  return resolved;
}

function publicPersonalAgentRuntimeConfig(config) {
  const copy = { ...config };
  const soulPromptConfigured = Boolean(copy.soulPromptConfigured || copy.soulPrompt);
  const launchBriefConfigured = Boolean(copy.launchBriefConfigured || copy.launchBrief);
  delete copy.soulPrompt;
  delete copy.launchBrief;
  return { ...copy, soulPromptConfigured, launchBriefConfigured };
}

async function personalAgentRuntimeState(env) {
  const config = resolvePersonalAgentConfig(env);
  const publicConfig = publicPersonalAgentRuntimeConfig(config);
  if (!config.enabled) {
    return {
      enabled: false,
      config: publicConfig,
      setup: { status: "disabled" }
    };
  }

  try {
    return {
      enabled: true,
      config: publicConfig,
      setup: await ensurePersonalAgentSetup(env, config)
    };
  } catch (error) {
    return {
      enabled: true,
      config: publicConfig,
      setup: {
        status: "error",
        error: error instanceof Error ? error.message : "Personal agent setup failed."
      }
    };
  }
}

async function ensurePersonalAgentSetup(env, config = resolvePersonalAgentConfig(env)) {
  if (!config.enabled) return { status: "disabled" };
  if (!env.DB) {
    return {
      status: "pending",
      error: "D1 binding is not configured."
    };
  }

  await ensureMemoryTable(env);
  await env.DB.prepare(
    "create table if not exists personal_agent_setup (id text primary key, preset_id text not null, label text not null, stack text not null, brain text not null, setup_kind text not null, setup_status text not null, advanced_mode integer not null, config_json text not null, setup_steps_json text not null, created_at text not null, updated_at text not null)"
  ).run();
  await env.DB.prepare(
    "create table if not exists personal_agent_feature_flags (feature_key text primary key, enabled integer not null, updated_at text not null)"
  ).run();

  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "select id from personal_agent_setup where id = ?"
  ).bind("personal-agent").first();
  const publicConfig = publicPersonalAgentRuntimeConfig(config);
  const setupSteps = JSON.stringify(config.setupSteps || []);
  await env.DB.prepare(
    "insert or ignore into personal_agent_setup (id, preset_id, label, stack, brain, setup_kind, setup_status, advanced_mode, config_json, setup_steps_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    "personal-agent",
    config.presetId,
    config.label,
    config.stack,
    config.brain,
    config.setupKind,
    config.setupStatus,
    config.advancedMode ? 1 : 0,
    JSON.stringify(publicConfig),
    setupSteps,
    now,
    now
  ).run();
  await env.DB.prepare(
    "update personal_agent_setup set preset_id = ?, label = ?, stack = ?, brain = ?, setup_kind = ?, setup_status = ?, advanced_mode = ?, config_json = ?, setup_steps_json = ?, updated_at = ? where id = ?"
  ).bind(
    config.presetId,
    config.label,
    config.stack,
    config.brain,
    config.setupKind,
    config.setupStatus,
    config.advancedMode ? 1 : 0,
    JSON.stringify(publicConfig),
    setupSteps,
    now,
    "personal-agent"
  ).run();
  for (const [featureKey, enabled] of Object.entries(config.features || {})) {
    await env.DB.prepare(
      "insert or replace into personal_agent_feature_flags (feature_key, enabled, updated_at) values (?, ?, ?)"
    ).bind(featureKey, enabled ? 1 : 0, now).run();
  }
  await env.DB.prepare(
    "insert or ignore into memories (id, text, created_at) values (?, ?, ?)"
  ).bind(
    "setup:" + deploymentId + ":personal-agent",
    buildPersonalAgentSetupMemory(config),
    now
  ).run();
  if (config.launchBrief) {
    await env.DB.prepare(
      "insert or replace into memories (id, text, created_at) values (?, ?, ?)"
    ).bind(
      "setup:" + deploymentId + ":launch-brief",
      "Initial launch brief for " + config.label + ":\\n" + config.launchBrief,
      now
    ).run();
  }
  if (!existing) {
    await queuePersonalAgentSetupTask(env, config, now);
  }

  const row = await env.DB.prepare(
    "select id, preset_id, label, stack, brain, setup_kind, setup_status, advanced_mode, config_json, setup_steps_json, created_at, updated_at from personal_agent_setup where id = ?"
  ).bind("personal-agent").first();
  return {
    status: row?.setup_status || config.setupStatus,
    table: "personal_agent_setup",
    record: row ? {
      id: row.id,
      presetId: row.preset_id,
      label: row.label,
      stack: row.stack,
      brain: row.brain,
      setupKind: row.setup_kind,
      advancedMode: Boolean(row.advanced_mode),
      config: parseJson(row.config_json, publicConfig),
      setupSteps: parseJson(row.setup_steps_json, config.setupSteps || []),
      featureFlags: await readPersonalAgentFeatureFlags(env),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    } : null
  };
}

async function readPersonalAgentFeatureFlags(env) {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    "select feature_key, enabled, updated_at from personal_agent_feature_flags order by feature_key asc"
  ).all();
  return (rows.results || []).map((row) => ({
    key: row.feature_key,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at
  }));
}

async function queuePersonalAgentSetupTask(env, config, now) {
  if (!env.TASK_QUEUE) return;
  await env.TASK_QUEUE.send({
    deploymentId,
    agentName,
    kind: "personal-agent-setup",
    createdAt: now,
    payload: {
      presetId: config.presetId,
      label: config.label,
      stack: config.stack,
      brain: config.brain,
      setupKind: config.setupKind,
      setupStatus: config.setupStatus,
      enabledFeatures: config.enabledFeatures || [],
      soulPromptConfigured: Boolean(config.soulPromptConfigured),
      launchBriefConfigured: Boolean(config.launchBriefConfigured),
      externalEndpoint: config.externalEndpoint || null,
      setupSteps: config.setupSteps || []
    }
  });
}

function personalAgentSystemInstruction(config) {
  if (!config.enabled) {
    return "Personal agent subsystem setup is disabled. Use the built-in OpenThink runtime defaults.";
  }
  const featureList = (config.enabledFeatures || []).join(", ") || "none";
  const parts = [
    "Personal agent subsystem: " + config.label + ".",
    "Stack: " + config.stack + ". Brain: " + config.brain + ".",
    "Setup status: " + config.setupStatus + ". Enabled features: " + featureList + ".",
    "Honor this brain/stack profile when choosing memory, MCP, task, file, and automation behavior.",
    config.setupStatus === "external-runtime-needed"
      ? "The OpenThink bootstrap has been seeded, but the external runtime still needs owner-provided endpoint, credentials, or workstation setup before you claim it is connected."
      : "The OpenThink runtime bootstrap has been seeded automatically."
  ];
  if (config.externalEndpoint) {
    parts.push("External endpoint configured: " + config.externalEndpoint + ".");
  }
  if (config.soulPrompt) {
    parts.push("Owner soul prompt:\\n" + config.soulPrompt);
  }
  if (config.launchBrief) {
    parts.push("Initial launch brief:\\n" + config.launchBrief);
  }
  return parts.join("\\n");
}

function buildPersonalAgentSetupMemory(config) {
  return [
    "Personal agent setup selected " + config.label + ".",
    "Stack " + config.stack + ".",
    "Brain " + config.brain + ".",
    "Enabled features " + ((config.enabledFeatures || []).join(", ") || "none") + ".",
    config.soulPromptConfigured ? "A custom soul prompt is configured." : "No custom soul prompt is configured.",
    config.launchBriefConfigured ? "An initial launch brief is configured." : "No initial launch brief is configured.",
    config.setupStatus === "external-runtime-needed"
      ? "External runtime connection remains as an owner follow-up."
      : "Runtime setup is complete."
  ].join(" ");
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

async function ensureMemoryTable(env) {
  await env.DB.prepare(
    "create table if not exists memories (id text primary key, text text not null, created_at text not null)"
  ).run();
}

async function ensureConversationTables(env) {
  await env.DB.prepare(
    "create table if not exists projects (id text primary key, name text not null, description text, created_at text not null, updated_at text not null)"
  ).run();
  await env.DB.prepare(
    "create table if not exists chat_threads (id text primary key, project_id text not null, title text not null, created_at text not null, updated_at text not null)"
  ).run();
  await env.DB.prepare(
    "create table if not exists chat_messages (id text primary key, thread_id text not null, role text not null, content text not null, created_at text not null)"
  ).run();
}

async function handleProjectsList(env) {
  if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
  await ensureConversationTables(env);
  await ensureDefaultProject(env);
  const rows = await env.DB.prepare(
    "select id, name, description, created_at, updated_at from projects order by updated_at desc limit 100"
  ).all();
  return Response.json({ projects: rows.results ?? [] });
}

async function handleProjectCreate(request, env) {
  if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
  const payload = await request.json().catch(() => ({}));
  const name = String(payload.name ?? "").trim().slice(0, 80);
  const description = String(payload.description ?? "").trim().slice(0, 500);
  if (!name) return Response.json({ error: "Project name is required." }, { status: 400 });
  await ensureConversationTables(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "insert into projects (id, name, description, created_at, updated_at) values (?, ?, ?, ?, ?)"
  ).bind(id, name, description || null, now, now).run();
  return Response.json({ project: { id, name, description, created_at: now, updated_at: now } });
}

async function handleThreadsList(url, env) {
  if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
  await ensureConversationTables(env);
  const projectId = String(url.searchParams.get("projectId") ?? "").trim() || await ensureDefaultProject(env);
  await ensureDefaultThread(env, projectId);
  const rows = await env.DB.prepare(
    "select id, project_id, title, created_at, updated_at from chat_threads where project_id = ? order by updated_at desc limit 100"
  ).bind(projectId).all();
  return Response.json({ projectId, threads: rows.results ?? [] });
}

async function handleThreadCreate(request, env) {
  if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
  const payload = await request.json().catch(() => ({}));
  await ensureConversationTables(env);
  const projectId = String(payload.projectId ?? "").trim() || await ensureDefaultProject(env);
  const title = String(payload.title ?? "New chat").trim().slice(0, 90) || "New chat";
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "insert into chat_threads (id, project_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)"
  ).bind(id, projectId, title, now, now).run();
  return Response.json({ thread: { id, project_id: projectId, title, created_at: now, updated_at: now } });
}

async function handleMessagesList(url, env) {
  if (!env.DB) return Response.json({ error: "D1 binding is not configured." }, { status: 503 });
  const threadId = String(url.searchParams.get("threadId") ?? "").trim();
  if (!threadId) return Response.json({ messages: [] });
  await ensureConversationTables(env);
  const rows = await env.DB.prepare(
    "select id, thread_id, role, content, created_at from chat_messages where thread_id = ? order by created_at asc limit 200"
  ).bind(threadId).all();
  return Response.json({ messages: rows.results ?? [] });
}

async function ensureDefaultProject(env) {
  const existing = await env.DB.prepare("select id from projects order by created_at asc limit 1").first();
  if (existing?.id) return existing.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "insert into projects (id, name, description, created_at, updated_at) values (?, ?, ?, ?, ?)"
  ).bind(id, "Personal", "Default workspace for chats, tasks, files, and Cloudflare operations.", now, now).run();
  return id;
}

async function ensureDefaultThread(env, projectId) {
  const existing = await env.DB.prepare(
    "select id from chat_threads where project_id = ? order by created_at asc limit 1"
  ).bind(projectId).first();
  if (existing?.id) return existing.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "insert into chat_threads (id, project_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)"
  ).bind(id, projectId, "General", now, now).run();
  return id;
}

async function saveConversationMessage(env, threadId, role, content) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "insert into chat_messages (id, thread_id, role, content, created_at) values (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), threadId, role, content, now).run();
  await env.DB.prepare("update chat_threads set updated_at = ? where id = ?").bind(now, threadId).run();
}

async function recentConversationMessages(env, threadId, limit) {
  const rows = await env.DB.prepare(
    "select role, content from chat_messages where thread_id = ? order by created_at desc limit ?"
  ).bind(threadId, limit).all();
  return (rows.results ?? []).reverse();
}

async function ensureMcpTable(env) {
  await env.DB.prepare(
    "create table if not exists mcp_servers (id text primary key, name text not null unique, url text not null unique, transport text not null, state text not null, error text, created_at text not null, updated_at text not null)"
  ).run();
}

async function listMcpServers(env) {
  const builtIn = {
    id: "cloudflare",
    name: "Cloudflare API",
    url: "https://mcp.cloudflare.com/mcp",
    transport: "runtime-secret-bridge",
    state: env.OPEN_THINK_CF_API_TOKEN ? "ready" : "authenticating",
    error: env.OPEN_THINK_CF_API_TOKEN ? null : "Cloudflare runtime token secret is not configured.",
    builtIn: true
  };
  const executor = executorMcpServerStatus(env);

  if (!env.DB) return [builtIn, executor];
  await ensureMcpTable(env);
  const rows = await env.DB.prepare(
    "select id, name, url, transport, state, error, created_at, updated_at from mcp_servers order by created_at asc limit 50"
  ).all();
  return [builtIn, executor, ...(rows.results ?? [])];
}

async function getMcpServer(env, idOrName) {
  if (idOrName === "executor") return executorMcpServer(env);
  if (!env.DB) return null;
  await ensureMcpTable(env);
  return env.DB.prepare(
    "select id, name, url, transport, state, error, created_at, updated_at from mcp_servers where id = ? or name = ? limit 1"
  )
    .bind(idOrName, idOrName)
    .first();
}

async function markMcpServer(env, id, state, error) {
  if (!env.DB) return;
  await env.DB.prepare("update mcp_servers set state = ?, error = ?, updated_at = ? where id = ?")
    .bind(state, error, new Date().toISOString(), id)
    .run();
}

function sanitizeMcpName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function sanitizeMcpUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (url.protocol !== "https:" && !isLocalhost) return "";
    if (!url.pathname.endsWith("/mcp")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function sanitizeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function executorMcpServerStatus(env) {
  const url = sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL);
  return {
    id: "executor",
    name: "Executor MCP",
    url: url || "OPEN_THINK_EXECUTOR_MCP_URL",
    transport: "streamable-http",
    state: url ? "ready" : "not-configured",
    error: url ? null : "Set OPEN_THINK_EXECUTOR_MCP_URL to enable executor.",
    builtIn: true,
    authTokenConfigured: Boolean(env.OPEN_THINK_EXECUTOR_AUTH_TOKEN)
  };
}

function executorMcpServer(env) {
  const server = executorMcpServerStatus(env);
  return server.state === "ready" ? server : null;
}

function executorMcpHeaders(env) {
  return env.OPEN_THINK_EXECUTOR_AUTH_TOKEN
    ? { Authorization: "Bearer " + env.OPEN_THINK_EXECUTOR_AUTH_TOKEN }
    : {};
}

function sanitizeSecretName(value) {
  const name = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(name)) return "";
  return name;
}

function sanitizeBindingName(value) {
  const name = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(name)) return "";
  return name;
}

function bindingStatus(env) {
  return {
    ai: Boolean(env.AI),
    db: Boolean(env.DB),
    storage: Boolean(env.AGENT_STORAGE),
    queue: Boolean(env.TASK_QUEUE),
    vectorize: Boolean(env.VECTORIZE),
    cloudflareApi: Boolean(env.OPEN_THINK_CF_API_TOKEN),
    cloudflareAccount: Boolean(env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY)
  };
}

function sanitizeObjectKey(value) {
  const key = String(value ?? "").trim().replace(/^\\/+/, "");
  if (!key || key.includes("..")) return "";
  return key.slice(0, 512);
}

function html(markup) {
  return new Response(markup, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
`.trimStart();
}

function renderAgentAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>open-think personal agent</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f1e8;
      --surface: #fffcf5;
      --surface-strong: #ffffff;
      --ink: #151716;
      --ink-soft: #4d5752;
      --muted: #797f78;
      --line: #d8d0c1;
      --line-strong: #bdb4a5;
      --accent: #df6f21;
      --accent-strong: #b84d12;
      --blue: #2d5f9a;
      --green: #176f49;
      --red: #b43b35;
      --mono: "SFMono-Regular", "Cascadia Code", "Roboto Mono", Consolas, monospace;
      --sans: "Aptos", "Segoe UI Variable", "Segoe UI", Arial, sans-serif;
      --radius: 8px;
      --radius-sm: 6px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      min-height: 100dvh;
      color: var(--ink);
      font-family: var(--sans);
      background:
        linear-gradient(90deg, rgba(21, 23, 22, 0.045) 1px, transparent 1px),
        linear-gradient(rgba(21, 23, 22, 0.04) 1px, transparent 1px),
        var(--bg);
      background-size: 38px 38px;
      letter-spacing: 0;
    }

    button, input, textarea { font: inherit; }
    button { border: 0; }
    :focus-visible { outline: 3px solid rgba(223, 111, 33, 0.42); outline-offset: 3px; }

    .shell {
      width: min(1480px, calc(100% - 32px));
      margin: 0 auto;
      padding: 22px 0 34px;
    }

    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      padding: 12px;
      background: rgba(255, 252, 245, 0.88);
      backdrop-filter: blur(14px);
    }

    .brand {
      display: flex;
      gap: 12px;
      align-items: center;
      min-width: 0;
    }

    .mark {
      display: grid;
      width: 38px;
      height: 38px;
      flex: 0 0 auto;
      place-items: center;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      color: var(--accent-strong);
      background: var(--surface);
      font-family: var(--mono);
      font-weight: 800;
    }

    .brand h1 {
      overflow: hidden;
      margin: 0;
      font-size: clamp(1rem, 2vw, 1.34rem);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .brand span {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.72rem;
    }

    .status-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 0 9px;
      color: var(--ink-soft);
      background: var(--surface-strong);
      font-size: 0.78rem;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 0 4px rgba(23, 111, 73, 0.12);
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(260px, 0.72fr) minmax(420px, 1.28fr) minmax(280px, 0.82fr);
      gap: 14px;
      align-items: start;
      margin-top: 14px;
    }

    .panel {
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: 0 16px 38px rgba(37, 31, 23, 0.08);
    }

    .panel-header {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
      border-bottom: 1px solid var(--line);
      padding: 14px;
    }

    .panel-header h2 {
      margin: 0;
      font-size: 0.98rem;
    }

    .panel-header p {
      margin: 4px 0 0;
      color: var(--ink-soft);
      font-size: 0.82rem;
      line-height: 1.35;
    }

    .panel-body { padding: 14px; }
    .stack { display: grid; gap: 10px; }

    .tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      margin-top: 12px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      padding: 8px;
      background: rgba(255, 252, 245, 0.72);
    }

    .tab-button {
      min-height: 36px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      padding: 0 12px;
      color: var(--ink-soft);
      background: transparent;
      cursor: pointer;
      white-space: nowrap;
    }

    .tab-button[aria-selected="true"] {
      border-color: var(--line-strong);
      color: var(--ink);
      background: var(--surface-strong);
      box-shadow: inset 0 -2px 0 rgba(184, 77, 18, 0.18);
    }

    .feature-hidden { display: none !important; }

    .metric {
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px;
      background: rgba(255, 252, 245, 0.7);
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 0.72rem;
    }

    .metric strong {
      display: block;
      overflow: hidden;
      margin-top: 5px;
      font-family: var(--mono);
      font-size: 0.82rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chat-log {
      display: grid;
      gap: 10px;
      align-content: start;
      align-items: start;
      min-height: 420px;
      max-height: calc(100dvh - 310px);
      overflow: auto;
      padding: 14px;
      background:
        linear-gradient(180deg, rgba(255,252,245,0.7), rgba(255,252,245,0.98));
    }

    .chat-status {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid var(--line);
      padding: 9px 14px;
      color: var(--ink-soft);
      font-family: var(--mono);
      font-size: 0.72rem;
      text-transform: uppercase;
    }

    .chat-status[data-state="streaming"] {
      color: var(--blue);
      background: rgba(45, 95, 154, 0.06);
    }

    .chat-status[data-state="error"] {
      color: var(--red);
      background: rgba(180, 59, 53, 0.06);
    }

    .message {
      align-self: start;
      max-width: 86%;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 10px 12px;
      background: var(--surface-strong);
      line-height: 1.45;
    }

    .message[data-role="user"] {
      justify-self: end;
      border-color: rgba(223, 111, 33, 0.34);
      background: #fff4e9;
    }

    .message[data-streaming="true"] {
      border-color: rgba(45, 95, 154, 0.32);
      background: rgba(45, 95, 154, 0.06);
    }

    .message small {
      display: block;
      margin-bottom: 5px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.68rem;
    }

    .message-content {
      white-space: normal;
    }

    .message-content p {
      margin: 0 0 0.7em;
    }

    .message-content p:last-child {
      margin-bottom: 0;
    }

    .message-content code {
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 1px 4px;
      background: rgba(21, 23, 22, 0.06);
      font-family: var(--mono);
      font-size: 0.88em;
    }

    .message-content pre {
      overflow: auto;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      padding: 10px;
      color: #f7efe4;
      background: #151716;
      font-family: var(--mono);
      font-size: 0.82rem;
      line-height: 1.45;
    }

    .message-content ul,
    .message-content ol {
      margin: 0.4em 0 0.8em;
      padding-left: 1.2rem;
    }

    .message-content li {
      margin: 0.28em 0;
    }

    .project-controls {
      display: grid;
      gap: 8px;
    }

    .thread-list {
      display: grid;
      gap: 7px;
      max-height: 250px;
      overflow: auto;
    }

    .thread-button {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 9px;
      color: var(--ink-soft);
      text-align: left;
      background: var(--surface-strong);
      cursor: pointer;
    }

    .thread-button[data-active="true"] {
      border-color: var(--accent-strong);
      color: var(--ink);
      background: #fff4e9;
    }

    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      border-bottom: 1px solid var(--line);
      padding: 10px 14px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 0.72rem;
    }

    .composer {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      border-top: 1px solid var(--line);
      padding: 14px;
    }

    .composer-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    input, textarea {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      padding: 10px 11px;
      color: var(--ink);
      background: var(--surface-strong);
    }

    select {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      padding: 10px 11px;
      color: var(--ink);
      background: var(--surface-strong);
    }

    textarea {
      min-height: 90px;
      resize: vertical;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 40px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      padding: 0 13px;
      color: var(--ink);
      background: var(--surface-strong);
      cursor: pointer;
      transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
    }

    .button:hover:not(:disabled) { transform: translateY(-1px); }
    .button:disabled { cursor: not-allowed; opacity: 0.58; }
    .button-primary { border-color: var(--accent-strong); color: #fffaf2; background: var(--accent-strong); }
    .button-block { width: 100%; }

    .list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .list li {
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 9px;
      background: var(--surface-strong);
      color: var(--ink-soft);
      font-size: 0.82rem;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .code {
      overflow: auto;
      min-height: 72px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      padding: 11px;
      color: #f7efe4;
      background: #151716;
      font-family: var(--mono);
      font-size: 0.76rem;
      line-height: 1.45;
      white-space: pre-wrap;
    }

    .compact-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }

    .mcp-call {
      display: grid;
      grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr);
      gap: 8px;
    }

    .updates-workspace {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: minmax(320px, 0.85fr) minmax(460px, 1.15fr);
      gap: 14px;
      align-items: start;
    }

    .update-hero {
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      padding: 16px;
      background: linear-gradient(135deg, rgba(255, 252, 245, 0.96), rgba(248, 241, 228, 0.78));
    }

    .update-hero h2 {
      margin: 0;
      font-size: 1.12rem;
    }

    .update-hero p {
      margin: 7px 0 0;
      color: var(--ink-soft);
      font-size: 0.86rem;
      line-height: 1.45;
    }

    .path-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .path-card {
      display: grid;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 12px;
      background: var(--surface-strong);
    }

    .path-card strong {
      display: block;
      font-size: 0.92rem;
    }

    .path-card span,
    .binding-note {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .binding-toolbar {
      display: grid;
      grid-template-columns: minmax(130px, 0.55fr) minmax(0, 0.8fr) minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }

    .binding-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
      max-height: 430px;
      overflow: auto;
    }

    .binding-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px;
      background: var(--surface-strong);
    }

    .binding-name {
      display: block;
      font-family: var(--mono);
      font-weight: 800;
      font-size: 0.8rem;
      overflow-wrap: anywhere;
    }

    .binding-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 5px;
      color: var(--muted);
      font-size: 0.75rem;
    }

    .binding-value {
      margin-top: 7px;
      color: var(--ink-soft);
      font-family: var(--mono);
      font-size: 0.76rem;
      overflow-wrap: anywhere;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 8px;
      background: rgba(255, 252, 245, 0.72);
    }

    .tag-secret {
      border-color: rgba(23, 111, 73, 0.24);
      color: var(--green);
      background: rgba(23, 111, 73, 0.08);
    }

    .link-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .notice {
      border: 1px solid rgba(45, 95, 154, 0.22);
      border-radius: var(--radius-sm);
      padding: 10px;
      color: var(--blue);
      background: rgba(45, 95, 154, 0.07);
      font-size: 0.82rem;
      line-height: 1.35;
    }

    .error {
      border-color: rgba(180, 59, 53, 0.3);
      color: var(--red);
      background: rgba(180, 59, 53, 0.08);
    }

    @media (max-width: 1120px) {
      .grid { grid-template-columns: 1fr; }
      .updates-workspace,
      .path-grid { grid-template-columns: 1fr; }
      .binding-toolbar { grid-template-columns: 1fr; }
      .chat-log { max-height: none; }
    }

    @media (max-width: 640px) {
      .shell { width: min(100% - 20px, 1480px); padding-top: 10px; }
      .topbar { grid-template-columns: 1fr; }
      .status-row { justify-content: flex-start; }
      .composer { grid-template-columns: 1fr; }
      .message { max-width: 100%; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="mark">ot</div>
        <div>
          <h1 id="agent-name">Personal Agent</h1>
          <span id="deployment-id">loading</span>
        </div>
      </div>
      <div class="status-row" id="status-row">
        <span class="pill"><span class="dot"></span>Access protected</span>
      </div>
    </header>

    <nav class="tabs" aria-label="Agent workspace">
      <button class="tab-button" type="button" data-tab="chat" aria-selected="true">Chat</button>
      <button class="tab-button" type="button" data-tab="subagents" aria-selected="false">Sub-agents</button>
      <button class="tab-button" type="button" data-tab="mcp" aria-selected="false">MCP and Cloudflare</button>
      <button class="tab-button" type="button" data-tab="secrets" aria-selected="false">Secrets and Models</button>
      <button class="tab-button" type="button" data-tab="updates" aria-selected="false">Updates</button>
      <button class="tab-button" type="button" data-tab="storage" aria-selected="false">Memory and Files</button>
      <button class="tab-button" type="button" data-tab="runtime" aria-selected="false">Runtime</button>
    </nav>

    <section class="grid">
      <aside class="panel" data-feature="chat">
        <div class="panel-header">
          <div>
            <h2>Projects</h2>
            <p>Group chats by project and keep thread history in D1.</p>
          </div>
        </div>
        <div class="panel-body stack">
          <div class="project-controls">
            <select id="project-select" aria-label="Project"></select>
            <div class="compact-row">
              <input id="project-name" placeholder="New project" />
              <button class="button" id="project-create" type="button">Add</button>
            </div>
            <div class="compact-row">
              <input id="thread-title" placeholder="New chat thread" />
              <button class="button" id="thread-create" type="button">New</button>
            </div>
          </div>
          <div class="thread-list" id="thread-list"></div>
        </div>
      </aside>

      <aside class="panel" data-feature="runtime">
        <div class="panel-header">
          <div>
            <h2>Runtime</h2>
            <p>Cloudflare resources attached to this agent.</p>
          </div>
        </div>
        <div class="panel-body stack" id="runtime-metrics"></div>
      </aside>

      <aside class="panel" data-feature="runtime">
        <div class="panel-header">
          <div>
            <h2>Hosted Agent SDK</h2>
            <p>Plug external apps into this Worker without scraping the chat UI.</p>
          </div>
        </div>
        <div class="panel-body stack">
          <div class="status-grid">
            <div class="metric"><span>Profile</span><strong>/cloud-agent/profile</strong></div>
            <div class="metric"><span>Goal</span><strong>/goal</strong></div>
            <div class="metric"><span>Sub-agents</span><strong>/subagents</strong></div>
          </div>
          <div class="notice">Use @open-think/core createHostedCloudAgentClient({ baseUrl: location.origin }) for health, manifest, /goal, sub-agent creation, messaging, controls, summaries, and setup reads.</div>
          <div class="code">import { createHostedCloudAgentClient } from "@open-think/core";
const agent = createHostedCloudAgentClient({ baseUrl: location.origin });
await agent.goal("Ship a hosted workflow");
await agent.createSubAgent({ name: "Scout", purpose: "Inspect deploy readiness", mode: "hybrid" });</div>
        </div>
      </aside>

      <section class="panel" data-feature="chat">
        <div class="panel-header">
          <div>
            <h2>Chat</h2>
            <p>Ask for code, plans, files, tasks, Cloudflare operations, or working notes.</p>
          </div>
        </div>
        <div class="meta-strip" id="chat-meta">Loading project context...</div>
        <div class="chat-log" id="chat-log"></div>
        <div class="chat-status" id="chat-status" data-state="idle">
          <span>SSE ready</span>
          <span id="chat-status-detail">Idle</span>
        </div>
        <form class="composer" id="chat-form">
              <input id="chat-input" name="message" placeholder="Ask, or start with /goal to set an active objective..." autocomplete="off" />
          <div class="composer-actions">
            <button class="button button-primary" type="submit">Send</button>
            <button class="button" id="chat-stop" type="button" disabled>Stop</button>
          </div>
        </form>
      </section>

      <section class="panel" data-feature="subagents">
        <div class="panel-header">
          <div>
            <h2>Sub-agents</h2>
            <p>Create scoped Cloud Agent Instance children, control their state, review summaries, and interact with focused threads.</p>
          </div>
        </div>
        <div class="panel-body stack">
          <form class="stack" id="subagent-form">
            <input id="subagent-name" placeholder="Research scout" value="Research scout" />
            <textarea id="subagent-purpose" placeholder="Mission or responsibility">Investigate one bounded topic and report back with options, risks, and next steps.</textarea>
            <div class="compact-row">
              <select id="subagent-mode">
                <option value="hybrid">Hybrid</option>
                <option value="agents-sdk">Agents SDK</option>
                <option value="executor">Executor</option>
              </select>
              <input id="subagent-brain" placeholder="gbrain + gskills" value="gbrain + gskills" />
            </div>
            <input id="subagent-skills" placeholder="research, planning, cloudflare" value="research, planning, cloudflare" />
            <textarea id="subagent-system" placeholder="Optional custom system prompt"></textarea>
            <button class="button button-primary" type="submit">Create sub-agent</button>
          </form>
          <div class="compact-row">
            <select id="subagent-select"></select>
            <button class="button" id="subagent-refresh" type="button">Refresh</button>
          </div>
          <div id="subagent-summary" class="notice">No sub-agent selected.</div>
          <div class="button-row">
            <button class="button" id="subagent-pause" type="button">Pause</button>
            <button class="button" id="subagent-resume" type="button">Resume</button>
            <button class="button" id="subagent-summarize" type="button">Summarize</button>
            <button class="button" id="subagent-explore" type="button">Explore</button>
            <button class="button" id="subagent-brief" type="button">Brief chat</button>
            <button class="button" id="subagent-archive" type="button">Archive</button>
          </div>
          <div id="subagent-messages" class="code">Sub-agent messages appear here.</div>
          <form class="stack" id="subagent-message-form">
            <textarea id="subagent-message" placeholder="Ask this sub-agent for a focused pass..."></textarea>
            <button class="button button-primary" type="submit">Send to sub-agent</button>
          </form>
        </div>
      </section>

      <section class="updates-workspace" data-feature="updates">
        <div class="stack">
          <div class="update-hero">
            <h2>Update Control</h2>
            <p>Use managed remote updates for upstream open-think releases. Use direct bundle updates only when the agent or platform has produced a verified worker.js artifact.</p>
          </div>

          <div class="path-grid">
            <section class="path-card">
              <div>
                <strong>Remote channel</strong>
                <span>GitHub source plus the platform reconciler. Best for pulling upstream changes, rebasing agent edits, and preserving deployment metadata.</span>
              </div>
              <div id="remote-status" class="notice">Checking remote repository...</div>
              <div class="link-row">
                <button class="button" id="remote-refresh" type="button">Check remote</button>
                <button class="button button-primary" id="remote-copy" type="button">Copy update prompt</button>
              </div>
            </section>

            <section class="path-card">
              <div>
                <strong>Direct bundle</strong>
                <span>Fetch a built worker.js bundle and replace this Worker through the Cloudflare API. Secrets are preserved.</span>
              </div>
              <form class="stack" id="update-form">
                <input id="update-bundle-url" placeholder="https://.../dist/worker.js" />
                <button class="button button-primary" type="submit">Apply bundle</button>
              </form>
            </section>

            <section class="path-card">
              <div>
                <strong>Self-edit workspace</strong>
                <span>Optional Artifacts Git plus Sandbox/Containers for agent-authored changes, tests, previews, and PR preparation.</span>
              </div>
              <div id="workspace-status" class="notice">Checking workspace...</div>
            </section>
          </div>

          <section class="panel">
            <div class="panel-header">
              <div>
                <h2>Readiness</h2>
                <p>What this deployment knows before updating itself.</p>
              </div>
            </div>
            <div class="panel-body stack">
              <div id="update-status" class="notice">Checking update readiness...</div>
              <div class="status-grid" id="update-metrics"></div>
              <button class="button" id="update-refresh" type="button">Refresh readiness</button>
              <div class="code" id="update-output">Update output appears here.</div>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Bindings</h2>
              <p>Plain text values are hidden until you reveal them. Encrypted secrets are marked and cannot be viewed.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="binding-toolbar">
              <select id="binding-type">
                <option value="plain_text">Plain text</option>
                <option value="r2_bucket">R2 bucket</option>
                <option value="d1">D1 database</option>
                <option value="queue">Queue</option>
                <option value="vectorize">Vectorize index</option>
                <option value="kv_namespace">KV namespace</option>
                <option value="service">Service binding</option>
              </select>
              <input id="binding-name" placeholder="BINDING_NAME" />
              <input id="binding-value" placeholder="Text, id, bucket, queue, index, namespace, or service" />
              <button class="button" id="binding-save" type="button">Save</button>
            </div>
            <p class="binding-note">For new resource-backed bindings, create or identify the Cloudflare resource first, then add the binding here or ask the agent to do both.</p>
            <ul class="binding-list" id="binding-list"></ul>
          </div>
        </section>
      </section>

      <aside class="stack">
        <section class="panel" data-feature="mcp">
          <div class="panel-header">
            <div>
              <h2>Cloudflare</h2>
              <p>MCP/API control-plane readiness.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div id="cf-status" class="notice">Checking Cloudflare runtime secret...</div>
            <button class="button button-block" id="cf-refresh" type="button">Refresh Cloudflare status</button>
          </div>
        </section>

        <section class="panel" data-feature="mcp">
          <div class="panel-header">
            <div>
              <h2>MCP Control</h2>
              <p>Advanced registry, discovery, and tool calls.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <form class="stack" id="mcp-register-form">
              <input id="mcp-name" placeholder="docs" />
              <input id="mcp-url" placeholder="https://docs.mcp.cloudflare.com/mcp" />
              <button class="button" type="submit">Register MCP server</button>
            </form>
            <div class="compact-row">
              <select id="mcp-server"></select>
              <button class="button" id="mcp-discover" type="button">Discover</button>
            </div>
            <ul class="list" id="mcp-server-list"></ul>
            <div class="mcp-call">
              <input id="mcp-tool-name" placeholder="search" />
              <textarea id="mcp-tool-args" placeholder='{"query":"workers"}'></textarea>
            </div>
            <button class="button button-block" id="mcp-call" type="button">Call MCP tool</button>
            <div class="code" id="mcp-output">MCP output appears here.</div>
          </div>
        </section>

        <section class="panel" data-feature="storage">
          <div class="panel-header">
            <div>
              <h2>Memory</h2>
              <p>Persist short notes in D1.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <form class="stack" id="memory-form">
              <textarea id="memory-input" placeholder="Store a preference, project fact, or instruction."></textarea>
              <button class="button" type="submit">Save memory</button>
            </form>
            <ul class="list" id="memory-list"></ul>
          </div>
        </section>

        <section class="panel" data-feature="storage">
          <div class="panel-header">
            <div>
              <h2>Files and Tasks</h2>
              <p>R2 artifacts and queued work.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <form class="stack" id="file-form">
              <input id="file-key" placeholder="notes/today.txt" />
              <textarea id="file-body" placeholder="File contents"></textarea>
              <button class="button" type="submit">Put file</button>
            </form>
            <form class="stack" id="task-form">
              <textarea id="task-body" placeholder="Queue a task for the agent runtime."></textarea>
              <button class="button" type="submit">Queue task</button>
            </form>
            <div class="code" id="terminal-box">Terminal: loading...</div>
          </div>
        </section>

        <section class="panel" data-feature="secrets">
          <div class="panel-header">
            <div>
              <h2>Secrets</h2>
              <p>Store provider keys on this Worker through the Cloudflare Secrets API.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div id="model-status" class="notice">Loading model settings...</div>
            <form class="stack" id="secret-form">
              <select id="secret-name">
                <option value="OPENROUTER_API_KEY">OpenRouter API key</option>
                <option value="ANTHROPIC_API_KEY">Anthropic API key</option>
                <option value="OPENAI_API_KEY">OpenAI API key</option>
                <option value="AI_GATEWAY_API_KEY">AI Gateway API key</option>
                <option value="OPEN_THINK_GITHUB_TOKEN">GitHub update token</option>
                <option value="OPEN_THINK_UPDATE_BUNDLE_TOKEN">Private bundle fetch token</option>
              </select>
              <input id="secret-value" type="password" placeholder="Paste secret value" autocomplete="off" />
              <button class="button" type="submit">Save secret</button>
            </form>
            <ul class="list" id="secret-list"></ul>
          </div>
        </section>

      </aside>
    </section>
  </main>

  <script>
    const state = { manifest: null, health: null, mcpServers: [], projects: [], threads: [], projectId: "", threadId: "", activeTab: "chat", chatAbortController: null, subAgents: [], subAgentId: "" };
    const $ = (id) => document.getElementById(id);

    function escapeText(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[char]);
    }

    function renderMessageText(value) {
      const normalized = String(value ?? "").replace(/\\\\n/g, "\\n").replace(/\\\\t/g, "  ");
      const fence = String.fromCharCode(96).repeat(3);
      const parts = normalized.split(fence);
      return parts.map((part, index) => {
        if (index % 2 === 1) {
          const codeLines = part.replace(/^\\w+\\n/, "");
          return "<pre><code>" + escapeText(codeLines.trim()) + "</code></pre>";
        }
        return renderMarkdownBlocks(part);
      }).join("");
    }

    function inlineMarkdown(value) {
      return escapeText(value)
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
        .replace(new RegExp(String.fromCharCode(96) + "([^" + String.fromCharCode(96) + "]+)" + String.fromCharCode(96), "g"), "<code>$1</code>");
    }

    function renderMarkdownBlocks(markdown) {
      const blocks = markdown.trim().split(/\\n{2,}/);
      return blocks.map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return "";
        if (/^#{1,3}\\s/.test(trimmed)) {
          const level = Math.min(trimmed.match(/^#+/)?.[0].length || 2, 3);
          return "<h" + level + ">" + inlineMarkdown(trimmed.replace(/^#{1,3}\\s+/, "")) + "</h" + level + ">";
        }
        if (/^[-*]\\s+/m.test(trimmed)) {
          const items = trimmed.split("\\n").filter(Boolean).map((line) => "<li>" + inlineMarkdown(line.replace(/^[-*]\\s+/, "")) + "</li>").join("");
          return "<ul>" + items + "</ul>";
        }
        if (/^\\d+\\.\\s+/m.test(trimmed)) {
          const items = trimmed.split("\\n").filter(Boolean).map((line) => "<li>" + inlineMarkdown(line.replace(/^\\d+\\.\\s+/, "")) + "</li>").join("");
          return "<ol>" + items + "</ol>";
        }
        return "<p>" + inlineMarkdown(trimmed).replace(/\\n/g, "<br>") + "</p>";
      }).join("");
    }

    function addMessage(role, text, options = {}) {
      const node = document.createElement("article");
      node.className = "message";
      node.dataset.role = role;
      if (options.streaming) node.dataset.streaming = "true";
      node.innerHTML = '<small>' + escapeText(role) + '</small><div class="message-content">' + renderMessageText(text) + '</div>';
      $("chat-log").appendChild(node);
      $("chat-log").scrollTop = $("chat-log").scrollHeight;
      return node;
    }

    function updateMessage(node, text) {
      const content = node.querySelector(".message-content");
      if (content) content.innerHTML = renderMessageText(text || "");
      $("chat-log").scrollTop = $("chat-log").scrollHeight;
    }

    function setChatStatus(stateName, detail) {
      const status = $("chat-status");
      if (!status) return;
      status.dataset.state = stateName;
      $("chat-status-detail").textContent = detail;
    }

    function setActiveTab(tab) {
      state.activeTab = tab;
      document.querySelectorAll(".tab-button").forEach((button) => {
        button.setAttribute("aria-selected", String(button.dataset.tab === tab));
      });
      document.querySelectorAll("[data-feature]").forEach((node) => {
        node.classList.toggle("feature-hidden", node.dataset.feature !== tab);
      });
    }

    function metric(label, value) {
      return '<div class="metric"><span>' + escapeText(label) + '</span><strong>' + escapeText(value) + '</strong></div>';
    }

    async function jsonFetch(url, init) {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    async function readEventStream(response, onEvent) {
      if (!response.body) throw new Error("Streaming response body is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const blocks = buffer.split(/\\r?\\n\\r?\\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const event = parseEventBlock(block);
          if (event) onEvent(event.name, event.data);
        }
      }

      const event = parseEventBlock(buffer);
      if (event) onEvent(event.name, event.data);
    }

    function parseEventBlock(block) {
      const lines = String(block || "").split(/\\r?\\n/);
      let name = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) return null;
      const raw = dataLines.join("\\n");
      try {
        return { name, data: JSON.parse(raw) };
      } catch {
        return { name, data: { text: raw } };
      }
    }

    async function loadBasics() {
      state.manifest = await jsonFetch("/manifest");
      state.health = await jsonFetch("/health");
      $("agent-name").textContent = state.manifest.agentName;
      $("deployment-id").textContent = state.manifest.deploymentId + " / " + state.manifest.owner;
      $("runtime-metrics").innerHTML = [
        metric("AI", state.health.bindings.ai ? "Workers AI bound" : "Missing"),
        metric("Model", state.health.defaultModel || "Not configured"),
        metric("D1", state.health.bindings.db ? "Memory ready" : "Missing"),
        metric("R2", state.health.bindings.storage ? "Artifacts ready" : "Missing"),
        metric("Queue", state.health.bindings.queue ? "Tasks ready" : "Missing"),
        metric("Vectorize", state.health.bindings.vectorize ? "Semantic memory bound" : "Missing"),
        metric("Chat", state.health.chat?.defaultTransport || "server-sent-events"),
        metric("Sub-agents", state.health.subAgents?.persistence || "Configured"),
        metric("Cloudflare API", state.health.bindings.cloudflareApi ? "Runtime secret present" : "OAuth/token needed")
      ].join("");
      await loadProjects();
      await loadMemory();
      await loadCloudflare();
      await loadMcpServers();
      await loadSubAgents();
      await loadSecrets();
      await loadUpdates();
      await loadTerminal();
      if (!$("chat-log").children.length) {
        addMessage("agent", "I am online on Cloudflare. Use /goal to set an active objective, or ask me to work on code, capture memory, manage files, queue tasks, or inspect Cloudflare.");
      }
      setActiveTab("chat");
    }

    async function loadProjects() {
      const select = $("project-select");
      try {
        const data = await jsonFetch("/projects");
        state.projects = data.projects || [];
        if (!state.projectId && state.projects[0]) state.projectId = state.projects[0].id;
        select.innerHTML = state.projects
          .map((project) => '<option value="' + escapeText(project.id) + '">' + escapeText(project.name) + "</option>")
          .join("");
        select.value = state.projectId;
        await loadThreads();
      } catch (error) {
        $("thread-list").innerHTML = '<button class="thread-button" type="button">' + escapeText(error.message) + "</button>";
      }
    }

    async function loadThreads() {
      const list = $("thread-list");
      if (!state.projectId) return;
      const data = await jsonFetch("/threads?projectId=" + encodeURIComponent(state.projectId));
      state.threads = data.threads || [];
      if (!state.threadId && state.threads[0]) state.threadId = state.threads[0].id;
      list.innerHTML = state.threads
        .map((thread) => '<button class="thread-button" type="button" data-thread="' + escapeText(thread.id) + '" data-active="' + String(thread.id === state.threadId) + '">' + escapeText(thread.title) + "</button>")
        .join("") || '<button class="thread-button" type="button">No threads yet</button>';
      $("chat-meta").textContent = "Project " + (state.projects.find((project) => project.id === state.projectId)?.name || "Personal") + " / " + (state.threads.find((thread) => thread.id === state.threadId)?.title || "General");
      await loadMessages();
    }

    async function loadMessages() {
      if (!state.threadId) return;
      const data = await jsonFetch("/messages?threadId=" + encodeURIComponent(state.threadId));
      $("chat-log").innerHTML = "";
      for (const message of data.messages || []) {
        addMessage(message.role, message.content);
      }
    }

    async function loadSubAgents(preferredId) {
      try {
        const data = await jsonFetch("/subagents");
        state.subAgents = data.subAgents || [];
        state.subAgentId = preferredId || state.subAgentId || state.subAgents[0]?.id || "";
        const select = $("subagent-select");
        select.innerHTML = state.subAgents
          .map((subAgent) => '<option value="' + escapeText(subAgent.id) + '">' + escapeText(subAgent.name + " / " + subAgent.status) + "</option>")
          .join("");
        select.value = state.subAgentId;
        renderSelectedSubAgent();
        if (state.subAgentId) await loadSubAgentMessages();
      } catch (error) {
        $("subagent-summary").className = "notice error";
        $("subagent-summary").textContent = error.message;
      }
    }

    function selectedSubAgent() {
      return state.subAgents.find((subAgent) => subAgent.id === state.subAgentId) || null;
    }

    const subAgentExplorePrompt =
      "Give me a current state report: what you know, what you still need, likely risks, and the next concrete action you recommend.";

    function renderSelectedSubAgent() {
      const subAgent = selectedSubAgent();
      if (!subAgent) {
        $("subagent-summary").className = "notice";
        $("subagent-summary").textContent = "No sub-agent selected.";
        $("subagent-messages").textContent = "Sub-agent messages appear here.";
        return;
      }
      $("subagent-summary").className = "notice";
      $("subagent-summary").innerHTML =
        "<strong>" + escapeText(subAgent.name) + "</strong> " +
        '<span class="tag">' + escapeText(subAgent.status) + "</span>" +
        '<span class="tag">' + escapeText(subAgent.mode) + "</span><br>" +
        escapeText(subAgent.purpose) +
        "<br><br>" +
        escapeText(subAgent.summary || "No summary yet.") +
        "<br><br>" +
        (subAgent.skills || []).slice(0, 4).map((skill) => '<span class="tag">' + escapeText(skill) + "</span>").join(" ");
    }

    async function loadSubAgentMessages() {
      if (!state.subAgentId) return;
      const data = await jsonFetch("/subagents/" + encodeURIComponent(state.subAgentId) + "/messages");
      const lines = (data.messages || []).map((message) =>
        "[" + message.role + "] " + message.content
      );
      $("subagent-messages").textContent = lines.join("\\n\\n") || "No messages yet.";
    }

    async function controlSubAgent(status) {
      if (!state.subAgentId) return;
      await jsonFetch("/subagents/" + encodeURIComponent(state.subAgentId) + "/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      await loadSubAgents(state.subAgentId);
    }

    async function summarizeSubAgent() {
      if (!state.subAgentId) return;
      await jsonFetch("/subagents/" + encodeURIComponent(state.subAgentId) + "/summary", { method: "POST" });
      await loadSubAgents(state.subAgentId);
    }

    async function exploreSubAgent() {
      if (!state.subAgentId) return;
      await jsonFetch("/subagents/" + encodeURIComponent(state.subAgentId) + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: subAgentExplorePrompt })
      });
      await loadSubAgents(state.subAgentId);
      await loadSubAgentMessages();
    }

    async function loadMemory() {
      const list = $("memory-list");
      try {
        const data = await jsonFetch("/memory");
        list.innerHTML = (data.memories || []).map((item) => "<li>" + escapeText(item.text) + "</li>").join("") || "<li>No memory yet.</li>";
      } catch (error) {
        list.innerHTML = '<li class="error">' + escapeText(error.message) + "</li>";
      }
    }

    async function loadCloudflare() {
      const box = $("cf-status");
      try {
        const data = await jsonFetch("/cloudflare/status");
        box.className = data.apiTokenAvailable ? "notice" : "notice error";
        box.textContent = data.apiTokenAvailable
          ? "Cloudflare API secret is available for account " + (data.accountId || "unknown") + ". MCP server: " + data.mcpServerUrl
          : "Cloudflare API runtime secret is not configured. Use OAuth MCP connection or add OPEN_THINK_CF_API_TOKEN.";
      } catch (error) {
        box.className = "notice error";
        box.textContent = error.message;
      }
    }

    async function loadSecrets() {
      const modelStatus = $("model-status");
      const list = $("secret-list");
      modelStatus.textContent = "Default model " + (state.health.defaultModel || "unknown") + " via " + (state.health.modelProvider || "workers-ai") + " / thinking " + (state.health.thinkingLevel || "medium") + ". If multiple provider keys are stored, the selected model provider wins.";
      try {
        const data = await jsonFetch("/secrets");
        const secrets = data.secrets || [];
        if (data.error) {
          list.innerHTML = '<li class="error">' + escapeText(data.error) + "</li>";
          return;
        }
        list.innerHTML = secrets.length
          ? secrets.map((secret) => "<li><strong>" + escapeText(secret.name || secret) + "</strong><br><span class=\\"tag tag-secret\\">encrypted secret</span><br>Stored by Cloudflare. Values cannot be viewed after saving.</li>").join("")
          : "<li>No provider secrets stored yet.</li>";
      } catch (error) {
        list.innerHTML = '<li class="error">' + escapeText(error.message) + "</li>";
      }
    }

    async function loadUpdates() {
      const statusBox = $("update-status");
      const metricBox = $("update-metrics");
      const bindingList = $("binding-list");
      try {
        const data = await jsonFetch("/updates/status");
        statusBox.className = data.ready ? "notice" : "notice error";
        statusBox.textContent = data.ready
          ? "Runtime updates are ready for " + (data.scriptName || "this Worker") + ". Managed remote updates are preferred for upstream releases."
          : (data.error || "Runtime updates need Cloudflare API token, account id, and script name.");
        metricBox.innerHTML = [
          metric("Script", data.scriptName || "unknown"),
          metric("Remote", data.remote?.repository || "NeoFlux-Holdings/OpenThink"),
          metric("Branch", data.remote?.branch || "main"),
          metric("Bundle", data.configuredBundleUrl ? "configured secret" : (data.remote?.bundlePath || "dist/worker.js")),
          metric("Workspace", data.workspace?.mode || "basic-github-updates")
        ].join("");
        const workspace = data.workspace || {};
        const workspaceBox = $("workspace-status");
        if (workspaceBox) {
          const artifactsReady = Boolean(workspace.artifacts?.configured);
          workspaceBox.className = artifactsReady ? "notice" : "notice";
          workspaceBox.innerHTML = artifactsReady
            ? "<strong>Artifacts workspace attached</strong><br>" +
              escapeText((workspace.artifacts?.namespace || "default") + "/" + (workspace.artifacts?.repo || "repo")) +
              "<br>Sandbox " + escapeText(workspace.sandbox?.status || "not-configured")
            : "<strong>Basic updates active</strong><br>Artifacts/Sandbox can be added later from the platform when this account has paid workspace capabilities.";
        }
        bindingList.innerHTML = (data.bindings || [])
          .map(renderBindingItem)
          .join("") || "<li>No bindings returned by Worker settings.</li>";
        await loadRemoteUpdate();
      } catch (error) {
        statusBox.className = "notice error";
        statusBox.textContent = error.message;
        metricBox.innerHTML = "";
        bindingList.innerHTML = '<li class="error">' + escapeText(error.message) + "</li>";
      }
    }

    async function loadRemoteUpdate() {
      const box = $("remote-status");
      try {
        const data = await jsonFetch("/updates/remote");
        box.className = data.ok ? "notice" : "notice error";
        const comparison = data.updateAvailable === true
          ? "Update available"
          : data.updateAvailable === false
            ? "Up to date"
            : "Reachable";
        box.innerHTML = "<strong>" + escapeText(comparison) + "</strong><br>" +
          escapeText(data.repository + " / " + data.branch) +
          "<br>Remote SHA " + escapeText(shortSha(data.remoteSha)) +
          (data.currentSha ? " - deployed " + escapeText(shortSha(data.currentSha)) : "<br>Deployed SHA not recorded yet.") +
          (data.error ? "<br>" + escapeText(data.error) : "");
        $("update-bundle-url").placeholder = data.bundleUrl || "https://.../dist/worker.js";
      } catch (error) {
        box.className = "notice error";
        box.textContent = error.message;
      }
    }

    function shortSha(value) {
      return value ? String(value).slice(0, 12) : "unknown";
    }

    function renderBindingItem(binding) {
      const value = String(binding.value || "");
      const encrypted = Boolean(binding.encrypted);
      const canReveal = Boolean(binding.canReveal);
      const state = encrypted ? "encrypted" : canReveal ? "hidden" : "reference";
      return '<li class="binding-item" data-binding-value="' + escapeText(value) + '" data-binding-state="' + state + '">' +
        '<div>' +
          '<span class="binding-name">' + escapeText(binding.name || "unnamed") + '</span>' +
          '<span class="binding-meta">' +
            '<span class="tag' + (encrypted ? " tag-secret" : "") + '">' + escapeText(binding.displayType || binding.type || "binding") + '</span>' +
            '<span class="tag">' + escapeText(encrypted ? "encrypted" : canReveal ? "hidden" : "reference") + '</span>' +
          '</span>' +
          '<div class="binding-value">' + escapeText(encrypted ? "Stored encrypted in Cloudflare. Value cannot be read back." : canReveal ? "Hidden" : (value || "No display value")) + '</div>' +
        '</div>' +
        (canReveal ? '<button class="button binding-reveal" type="button">Reveal</button>' : '') +
      '</li>';
    }

    function bindingPayloadFromForm() {
      const type = $("binding-type").value;
      const name = $("binding-name").value.trim();
      const value = $("binding-value").value.trim();
      const payload = { type, name };
      if (type === "plain_text") payload.text = value;
      if (type === "r2_bucket") payload.bucket_name = value;
      if (type === "d1") payload.id = value;
      if (type === "queue") payload.queue_name = value;
      if (type === "vectorize") payload.index_name = value;
      if (type === "kv_namespace") payload.namespace_id = value;
      if (type === "service") payload.service = value;
      return payload;
    }

    async function loadMcpServers() {
      const list = $("mcp-server-list");
      const select = $("mcp-server");
      try {
        const data = await jsonFetch("/mcp/servers");
        state.mcpServers = data.servers || [];
        select.innerHTML = state.mcpServers
          .map((server) => '<option value="' + escapeText(server.id) + '">' + escapeText(server.name || server.id) + " / " + escapeText(server.state) + "</option>")
          .join("");
        list.innerHTML = state.mcpServers
          .map((server) => "<li><strong>" + escapeText(server.name || server.id) + "</strong><br>" + escapeText(server.url) + "<br>" + escapeText(server.state) + (server.error ? " - " + escapeText(server.error) : "") + "</li>")
          .join("") || "<li>No MCP servers registered.</li>";
      } catch (error) {
        list.innerHTML = '<li class="error">' + escapeText(error.message) + "</li>";
      }
    }

    async function discoverMcpTools() {
      const server = $("mcp-server").value || "cloudflare";
      const output = $("mcp-output");
      output.textContent = "Discovering tools...";
      try {
        const data = await jsonFetch("/mcp/tools?server=" + encodeURIComponent(server));
        output.textContent = JSON.stringify(data.tools || data, null, 2);
        await loadMcpServers();
      } catch (error) {
        output.textContent = error.message;
      }
    }

    async function callMcpTool() {
      const server = $("mcp-server").value || "cloudflare";
      const name = $("mcp-tool-name").value.trim();
      const rawArgs = $("mcp-tool-args").value.trim() || "{}";
      const output = $("mcp-output");
      if (!name) return;
      output.textContent = "Calling " + name + "...";
      try {
        const args = JSON.parse(rawArgs);
        const data = await jsonFetch("/mcp/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ server, name, arguments: args })
        });
        output.textContent = JSON.stringify(data.result ?? data, null, 2);
        addMessage("agent", "MCP " + server + "." + name + " completed. Result is in the MCP control panel.");
        await loadMcpServers();
      } catch (error) {
        output.textContent = error.message;
      }
    }

    async function loadTerminal() {
      try {
        const data = await jsonFetch("/terminal");
        $("terminal-box").textContent = data.command + "\\n" + data.note;
      } catch (error) {
        $("terminal-box").textContent = error.message;
      }
    }

    $("chat-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("chat-input");
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      addMessage("user", message);
      const button = event.currentTarget.querySelector("button");
      const stopButton = $("chat-stop");
      const controller = new AbortController();
      const agentMessage = addMessage("agent", "", { streaming: true });
      let streamedText = "";
      let refreshThreads = false;
      state.chatAbortController = controller;
      button.disabled = true;
      stopButton.disabled = false;
      setChatStatus("streaming", "Thinking");
      try {
        const response = await fetch("/chat?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ message, projectId: state.projectId, threadId: state.threadId, stream: true }),
          signal: controller.signal
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Chat request failed");
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream")) {
          const data = await response.json();
          streamedText = typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2);
          updateMessage(agentMessage, streamedText);
          if (data.projectId) state.projectId = data.projectId;
          if (data.threadId) state.threadId = data.threadId;
          refreshThreads = true;
        } else {
          await readEventStream(response, (name, data) => {
            if (name === "status") {
              setChatStatus("streaming", data.status || "Working");
            }
            if (name === "metadata") {
              if (data.projectId) state.projectId = data.projectId;
              if (data.threadId) state.threadId = data.threadId;
              setChatStatus("streaming", (data.modelProvider || "model") + " / " + (data.model || "stream"));
            }
            if (name === "delta") {
              streamedText += String(data.content || "");
              updateMessage(agentMessage, streamedText);
            }
            if (name === "done") {
              if (data.projectId) state.projectId = data.projectId;
              if (data.threadId) state.threadId = data.threadId;
              if (typeof data.output === "string" && !streamedText) {
                streamedText = data.output;
                updateMessage(agentMessage, streamedText);
              }
              setChatStatus("idle", "Complete");
            }
            if (name === "error") {
              throw new Error(data.error || "Chat stream failed");
            }
          });
          refreshThreads = true;
        }
        agentMessage.dataset.streaming = "false";
        setChatStatus("idle", "Idle");
      } catch (error) {
        agentMessage.dataset.streaming = "false";
        const stopped = error?.name === "AbortError";
        updateMessage(agentMessage, stopped ? "Stopped." : (error?.message || "Chat request failed."));
        setChatStatus(stopped ? "idle" : "error", stopped ? "Stopped" : "Error");
      } finally {
        state.chatAbortController = null;
        if (refreshThreads) await loadThreads();
        button.disabled = false;
        stopButton.disabled = true;
      }
    });

    $("chat-stop").addEventListener("click", () => {
      if (state.chatAbortController) state.chatAbortController.abort();
    });

    $("memory-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = $("memory-input").value.trim();
      if (!text) return;
      await jsonFetch("/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      $("memory-input").value = "";
      await loadMemory();
    });

    $("file-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const key = $("file-key").value.trim();
      const body = $("file-body").value;
      if (!key) return;
      await fetch("/files?key=" + encodeURIComponent(key), { method: "PUT", body });
      $("file-body").value = "";
      addMessage("agent", "Stored file " + key + " in R2.");
    });

    $("task-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = $("task-body").value.trim();
      if (!text) return;
      await jsonFetch("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      $("task-body").value = "";
      addMessage("agent", "Queued task: " + text);
    });

    $("mcp-register-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = $("mcp-name").value.trim();
      const url = $("mcp-url").value.trim();
      if (!name || !url) return;
      await jsonFetch("/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url })
      });
      $("mcp-name").value = "";
      $("mcp-url").value = "";
      await loadMcpServers();
    });

    $("secret-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = $("secret-name").value;
      const value = $("secret-value").value;
      if (!name || !value) return;
      await jsonFetch("/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value })
      });
      $("secret-value").value = "";
      await loadSecrets();
      addMessage("agent", "Stored " + name + " as a Cloudflare Worker secret. Future model calls can use it.");
    });

    $("update-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const moduleUrl = $("update-bundle-url").value.trim();
      const output = $("update-output");
      output.textContent = "Applying update...";
      try {
        const data = await jsonFetch("/updates/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(moduleUrl ? { moduleUrl } : {})
        });
        output.textContent = JSON.stringify(data, null, 2);
        addMessage("agent", "Started a Worker update for " + (data.scriptName || "this agent") + ". Refresh after Cloudflare finishes deploying the new version.");
        await loadUpdates();
      } catch (error) {
        output.textContent = error.message;
      }
    });

    $("update-refresh").addEventListener("click", async () => {
      await loadUpdates();
    });

    $("remote-refresh").addEventListener("click", async () => {
      await loadRemoteUpdate();
    });

    $("remote-copy").addEventListener("click", async () => {
      const prompt = [
        "Check the configured open-think remote for updates.",
        "If upstream changed, explain what will change before applying it.",
        "If this agent has local runtime changes, preserve secrets and bindings, reconcile or rebase safely, and ask before destructive replacement.",
        "Prefer the managed platform update path; use direct bundle update only for a verified worker.js artifact."
      ].join("\\n");
      await navigator.clipboard?.writeText(prompt).catch(() => undefined);
      addMessage("agent", "Copied the update-management prompt. You can paste it into chat when you want me to manage an update.");
    });

    $("binding-list").addEventListener("click", (event) => {
      const button = event.target.closest(".binding-reveal");
      if (!button) return;
      const item = button.closest(".binding-item");
      const valueNode = item?.querySelector(".binding-value");
      if (!item || !valueNode) return;
      const isVisible = item.dataset.bindingState === "visible";
      item.dataset.bindingState = isVisible ? "hidden" : "visible";
      valueNode.textContent = isVisible ? "Hidden" : item.dataset.bindingValue || "";
      button.textContent = isVisible ? "Reveal" : "Hide";
    });

    $("binding-save").addEventListener("click", async () => {
      const output = $("update-output");
      output.textContent = "Patching binding...";
      try {
        const data = await jsonFetch("/updates/bindings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bindingPayloadFromForm())
        });
        output.textContent = JSON.stringify(data, null, 2);
        $("binding-value").value = "";
        await loadUpdates();
        addMessage("agent", "Updated binding " + ($("binding-name").value || "requested binding") + " in Worker settings.");
      } catch (error) {
        output.textContent = error.message;
      }
    });

    $("project-select").addEventListener("change", async (event) => {
      state.projectId = event.currentTarget.value;
      state.threadId = "";
      await loadThreads();
    });

    $("project-create").addEventListener("click", async () => {
      const name = $("project-name").value.trim();
      if (!name) return;
      const data = await jsonFetch("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      $("project-name").value = "";
      state.projectId = data.project.id;
      state.threadId = "";
      await loadProjects();
    });

    $("thread-create").addEventListener("click", async () => {
      const title = $("thread-title").value.trim() || "New chat";
      const data = await jsonFetch("/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: state.projectId, title })
      });
      $("thread-title").value = "";
      state.threadId = data.thread.id;
      await loadThreads();
    });

    $("thread-list").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-thread]");
      if (!button) return;
      state.threadId = button.dataset.thread;
      await loadThreads();
    });

    $("subagent-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = await jsonFetch("/subagents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("subagent-name").value.trim(),
          purpose: $("subagent-purpose").value.trim(),
          mode: $("subagent-mode").value,
          brain: $("subagent-brain").value.trim(),
          skills: $("subagent-skills").value.split(",").map((skill) => skill.trim()).filter(Boolean),
          systemPrompt: $("subagent-system").value.trim()
        })
      });
      $("subagent-name").value = "Research scout";
      $("subagent-purpose").value = "Investigate one bounded topic and report back with options, risks, and next steps.";
      $("subagent-mode").value = "hybrid";
      $("subagent-brain").value = "gbrain + gskills";
      $("subagent-skills").value = "research, planning, cloudflare";
      $("subagent-system").value = "";
      await loadSubAgents(data.subAgent?.id);
    });

    $("subagent-select").addEventListener("change", async () => {
      state.subAgentId = $("subagent-select").value;
      renderSelectedSubAgent();
      await loadSubAgentMessages();
    });

    $("subagent-refresh").addEventListener("click", () => loadSubAgents(state.subAgentId));
    $("subagent-pause").addEventListener("click", () => controlSubAgent("paused"));
    $("subagent-resume").addEventListener("click", () => controlSubAgent("ready"));
    $("subagent-archive").addEventListener("click", () => controlSubAgent("archived"));
    $("subagent-summarize").addEventListener("click", summarizeSubAgent);
    $("subagent-explore").addEventListener("click", exploreSubAgent);
    $("subagent-brief").addEventListener("click", () => {
      const subAgent = selectedSubAgent();
      if (!subAgent) return;
      $("chat-input").value = "Review sub-agent " + subAgent.name + " (" + subAgent.status + "). Purpose: " + subAgent.purpose + "\\n\\nCurrent summary: " + subAgent.summary;
      setActiveTab("chat");
      $("chat-input").focus();
    });

    $("subagent-message-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.subAgentId) return;
      const message = $("subagent-message").value.trim();
      if (!message) return;
      await jsonFetch("/subagents/" + encodeURIComponent(state.subAgentId) + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      $("subagent-message").value = "";
      await loadSubAgents(state.subAgentId);
      await loadSubAgentMessages();
    });

    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });

    $("cf-refresh").addEventListener("click", loadCloudflare);
    $("mcp-discover").addEventListener("click", discoverMcpTools);
    $("mcp-call").addEventListener("click", callMcpTool);
    loadBasics().catch((error) => addMessage("agent", error.message));
  </script>
</body>
</html>`;
}
