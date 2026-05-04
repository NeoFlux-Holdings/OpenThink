import type { DeploymentRequest } from "./deployment-engine";

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
const appHtml = ${appHtml};
const runtimeAwarenessVersion = "2026-05-04.2";
const capabilities = ["chat", "coding", "messaging", "files", "memory", "tasks", "terminal", "mcp", "cloudflare-api", "self-update", "binding-management", "cloudflare-sandbox-planning", "cloudflare-container-planning", "cloudflare-app-deployment-planning"];
const endpoints = ["/", "/health", "/manifest", "/skills", "/chat", "/projects", "/threads", "/messages", "/memory", "/files", "/tasks", "/terminal", "/secrets", "/updates/status", "/updates/remote", "/updates/apply", "/updates/bindings", "/runtime/context", "/cloudflare/status", "/cloudflare/api", "/mcp/cloudflare", "/mcp/servers", "/mcp/tools", "/mcp/call"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/app")) {
      return html(appHtml);
    }

    if (url.pathname === "/health") {
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
        runtimeAwarenessVersion,
        capabilities,
        bindings: bindingStatus(env)
      });
    }

    if (url.pathname === "/manifest") {
      return Response.json({
        deploymentId,
        agentName,
        owner,
        status: "ready",
        spendLimitUsd,
        defaultModel: env.OPEN_THINK_DEFAULT_MODEL || defaultModel,
        modelProvider: env.OPEN_THINK_MODEL_PROVIDER || modelProvider,
        thinkingLevel: env.OPEN_THINK_THINKING_LEVEL || thinkingLevel,
        runtimeAwarenessVersion,
        cloudflareAccountId: env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null,
        capabilities,
        endpoints,
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

    if (url.pathname === "/skills") {
      return Response.json(cloudflarePlatformSkills(env));
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
      endpoints
    });
  }
};

async function handleChat(request, env) {
  const payload = await request.json().catch(() => ({}));
  const message = String(payload.message ?? "").trim();
  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  const modelSettings = resolveModelSettings(env);
  if (modelSettings.provider === "workers-ai" && !env.AI) {
    return Response.json({ error: "Workers AI binding is not configured." }, { status: 503 });
  }

  let projectId = String(payload.projectId ?? "").trim();
  let threadId = String(payload.threadId ?? "").trim();
  let history = [];
  if (env.DB) {
    await ensureConversationTables(env);
    projectId = projectId || await ensureDefaultProject(env);
    threadId = threadId || await ensureDefaultThread(env, projectId);
    history = await recentConversationMessages(env, threadId, 10);
    await saveConversationMessage(env, threadId, "user", message);
  }

  const runtime = await runtimeSnapshot(env);
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
        "You have direct awareness of this deployment through the runtime snapshot below. Do not say you lack the script name, D1 memory table, bindings, update strategy, or Cloudflare account context when it is present in that snapshot.",
        "You have explicit Cloudflare platform skills in the runtime snapshot. When asked about Sandbox, Containers, Workers, Pages, or deploying new software, use those skills. Do not claim Containers or Sandbox are impossible; say whether they are available in this runtime, what account plan/bindings are required, and how you would add them.",
        "Decision rule: Workers/Pages first for HTTP apps, APIs, static sites, scheduled jobs, queues, and edge-native integrations. Sandbox for untrusted or agent-generated code execution, command execution, file work, browser terminals, preview URLs, data analysis, and ephemeral IDE/CI workflows. Containers for custom runtimes, existing Docker images, long-running services, heavier CPU/memory/disk, Linux tools, or servers that Workers cannot run. Durable Objects coordinate stateful sessions and per-user instances. R2, D1, Queues, Vectorize, AI, Workflows, and Access compose around these choices.",
        "Builder workflow: first classify the requested software, then propose the smallest Cloudflare architecture, list required permissions/bindings/resources, identify paid-plan or beta gates, create a deployment plan, ask before cost-bearing/destructive operations, then use MCP/API/update tools to provision or generate the code. If the current runtime lacks a binding, explain the exact binding/config update needed instead of saying the feature is unavailable.",
        "Safety workflow for executable code: never run untrusted code in the Worker isolate. Prefer Sandbox for short-lived command/code execution and Containers for custom runtimes or long-running services. For secrets, use Worker secrets and never echo values. For public apps, include Access, custom domain/DNS, spend guardrails, logging, rollback, and update strategy.",
        "D1 memory is available through the built-in memory_list tool and the /memory endpoint. If asked what memory says, answer from recent D1 memory rows or call memory_list. Do not ask the owner for the D1 database id for this agent's own memory.",
        "R2 files are available through files_list and /files. Tasks are available through queue_task and /tasks. Runtime and update status are available through runtime_status and /runtime/context.",
        "Vectorize is provisioned as semantic memory when the VECTORIZE binding is present; explain that vector query wiring is a next runtime tool if no direct vector query tool is available.",
        "For source updates, explain the two supported paths: managed remote updates from the configured GitHub/open-think repository through the platform Artifacts/mcpu-style reconciler, or this runtime's /updates/apply endpoint that uploads a built worker.js bundle through the Workers Scripts API while preserving secrets. Managed remote updates are preferred when the owner wants to pull from upstream; direct bundle updates are for a verified generated artifact.",
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

  return Response.json({
    deploymentId,
    starterTemplate,
    projectId: projectId || null,
    threadId: threadId || null,
    model: modelSettings.model,
    modelProvider: modelSettings.provider,
    output: responseText,
    toolResults,
    usage: output?.usage ?? null
  });
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
            server: { type: "string", description: "MCP server id or name. Use cloudflare for Cloudflare API." },
            name: { type: "string", enum: ["search", "execute"] },
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

  const builtInXmlCalls = String(responseText ?? "").matchAll(/<invoke\\s+name=["'](runtime_status|memory_list|files_list|queue_task|secret_put|binding_add|update_status|cloudflare_platform_advice)["'][\\s\\S]*?<\\/invoke>/g);
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
      : { ok: false, error: "Only the built-in Cloudflare MCP bridge is currently available from chat." };
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
  if (primary === "sandbox") return [...common, "Containers Edit or Cloudchamber Edit", "Workers R2 Storage Edit for artifacts", "D1 Edit for session metadata"];
  if (primary === "containers") return [...common, "Containers Edit or Cloudchamber Edit", "Workers R2 Storage Edit for artifacts or mounted buckets"];
  return [...common, "D1/R2/KV/Queues/Vectorize/AI Gateway depending on chosen bindings"];
}

async function runtimeSnapshot(env) {
  const accountId = env.OPEN_THINK_CF_ACCOUNT_ID || cloudflareAccountId || null;
  const currentScript = runtimeScriptName(env) || null;
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
    bindings: bindingStatus(env),
    storage: {
      d1MemoryTable: env.DB ? "memories" : null,
      d1ConversationTables: env.DB ? ["projects", "chat_threads", "chat_messages"] : [],
      r2Binding: env.AGENT_STORAGE ? "AGENT_STORAGE" : null,
      queueBinding: env.TASK_QUEUE ? "TASK_QUEUE" : null,
      vectorizeBinding: env.VECTORIZE ? "VECTORIZE" : null
    },
    tools: {
      builtIn: ["runtime_status", "memory_list", "files_list", "queue_task", "secret_put", "binding_add", "update_status", "cloudflare_platform_advice", "mcp_call"],
      mcp: {
        cloudflare: {
          serverUrl: "https://mcp.cloudflare.com/mcp",
          tools: ["search", "execute"],
          runtimeSecretAvailable: Boolean(env.OPEN_THINK_CF_API_TOKEN)
        },
        docs: "https://docs.mcp.cloudflare.com/mcp"
      }
    },
    skills: cloudflarePlatformSkills(env),
    sourceUpdate: {
      platformUpdateApi: "/api/deployment/update on the open-think platform",
      artifactSync: "mcpu-style Artifacts Git flow: pull, commit, push, deploy, reconcile",
      remoteRepository: env.OPEN_THINK_UPDATE_REPOSITORY || "tzarebczan/open-think",
      remoteBranch: env.OPEN_THINK_UPDATE_BRANCH || "main",
      remoteBundlePath: env.OPEN_THINK_UPDATE_BUNDLE_PATH || "dist/worker.js",
      remoteStatusEndpoint: "/updates/remote",
      runtimeStatusEndpoint: "/updates/status",
      runtimeApplyEndpoint: "/updates/apply",
      runtimeBindingsEndpoint: "/updates/bindings",
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
    repository: String(env.OPEN_THINK_UPDATE_REPOSITORY || "tzarebczan/open-think"),
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

async function mcpRequest(serverUrl, method, params) {
  const id = crypto.randomUUID();
  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
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

  if (!env.DB) return [builtIn];
  await ensureMcpTable(env);
  const rows = await env.DB.prepare(
    "select id, name, url, transport, state, error, created_at, updated_at from mcp_servers order by created_at asc limit 50"
  ).all();
  return [builtIn, ...(rows.results ?? [])];
}

async function getMcpServer(env, idOrName) {
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

      <section class="panel" data-feature="chat">
        <div class="panel-header">
          <div>
            <h2>Chat</h2>
            <p>Ask for code, plans, files, tasks, Cloudflare operations, or working notes.</p>
          </div>
        </div>
        <div class="meta-strip" id="chat-meta">Loading project context...</div>
        <div class="chat-log" id="chat-log"></div>
        <form class="composer" id="chat-form">
          <input id="chat-input" name="message" placeholder="Ask your agent to build, explain, plan, or operate..." autocomplete="off" />
          <button class="button button-primary" type="submit">Send</button>
        </form>
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
    const state = { manifest: null, health: null, mcpServers: [], projects: [], threads: [], projectId: "", threadId: "", activeTab: "chat" };
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

    function addMessage(role, text) {
      const node = document.createElement("article");
      node.className = "message";
      node.dataset.role = role;
      node.innerHTML = '<small>' + escapeText(role) + '</small><div class="message-content">' + renderMessageText(text) + '</div>';
      $("chat-log").appendChild(node);
      $("chat-log").scrollTop = $("chat-log").scrollHeight;
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
        metric("Cloudflare API", state.health.bindings.cloudflareApi ? "Runtime secret present" : "OAuth/token needed")
      ].join("");
      await loadProjects();
      await loadMemory();
      await loadCloudflare();
      await loadMcpServers();
      await loadSecrets();
      await loadUpdates();
      await loadTerminal();
      if (!$("chat-log").children.length) {
        addMessage("agent", "I am online on Cloudflare. Ask me to work on code, capture memory, manage files, queue tasks, or inspect Cloudflare.");
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
          metric("Remote", data.remote?.repository || "tzarebczan/open-think"),
          metric("Branch", data.remote?.branch || "main"),
          metric("Bundle", data.configuredBundleUrl ? "configured secret" : (data.remote?.bundlePath || "dist/worker.js"))
        ].join("");
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
      button.disabled = true;
      try {
        const data = await jsonFetch("/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, projectId: state.projectId, threadId: state.threadId })
        });
        if (data.projectId) state.projectId = data.projectId;
        if (data.threadId) state.threadId = data.threadId;
        addMessage("agent", typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2));
        await loadThreads();
      } catch (error) {
        addMessage("agent", error.message);
      } finally {
        button.disabled = false;
      }
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
