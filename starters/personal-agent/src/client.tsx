import { FormEvent, Suspense, lazy, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import {
  getToolApproval,
  getToolCallId,
  getToolInput,
  getToolOutput,
  getToolPartState,
  useAgentChat
} from "@cloudflare/ai-chat/react";
import {
  getToolName,
  isTextUIPart,
  isToolUIPart,
  type UIMessage
} from "ai";
import "./client.css";

const MarkdownRenderer = lazy(async () => {
  const { Streamdown } = await import("streamdown");
  return {
    default: function MarkdownRenderer({ children }: { children: string }) {
      return <Streamdown>{children}</Streamdown>;
    }
  };
});

const clientConfig = {
  agentName: "Personal Agent",
  deploymentId: "local",
  defaultModel: "@cf/moonshotai/kimi-k2.6",
  toolApprovalPolicy: "auto"
} as const;

function App() {
  return (
    <main className="app">
      <Chat />
    </main>
  );
}

function Chat() {
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerState>>({});
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<Set<string>>(() => readAlwaysAllowedTools());
  const autoApprovedApprovalIdsRef = useRef<Set<string>>(new Set());
  const messageListEndRef = useRef<HTMLDivElement | null>(null);
  const agent = useAgent({
    agent: "PersonalChatAgent",
    name: "default",
    onMcpUpdate: (servers) => setMcpServers(servers as Record<string, McpServerState>)
  });
  const {
    messages,
    sendMessage,
    clearHistory,
    stop,
    regenerate,
    clearError,
    addToolApprovalResponse,
    status,
    error,
    isStreaming,
    isServerStreaming,
    isToolContinuation
  } = useAgentChat({
    agent,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName !== "getUserTimezone") return;

      addToolOutput({
        toolCallId: toolCall.toolCallId,
        output: browserTimeContext()
      });
    }
  });

  const connectionState = readyStateLabel(agent.readyState);
  const connected = agent.readyState === WebSocket.OPEN;
  const busy = status === "submitted" || status === "streaming" || isStreaming || isServerStreaming;
  const pendingApprovalCount = countPendingApprovals(messages);
  const mcpServerValues = Object.values(mcpServers);
  const mcpReadyCount = mcpServerValues.filter((server) => isMcpReady(server)).length;
  const alwaysAllowedToolCount = alwaysAllowedTools.size;
  const activityLabel = busy ? (isToolContinuation ? "Continuing tool" : "Streaming") : "Idle";

  useEffect(() => {
    messageListEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status, isStreaming, isServerStreaming]);

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

        const approval = getToolApproval(part);
        const toolName = getToolName(part);
        if (!approval?.id || !alwaysAllowedTools.has(toolApprovalPreferenceKey(toolName))) continue;
        if (autoApprovedApprovalIdsRef.current.has(approval.id)) continue;

        autoApprovedApprovalIdsRef.current.add(approval.id);
        addToolApprovalResponse({ id: approval.id, approved: true });
      }
    }
  }, [addToolApprovalResponse, alwaysAllowedTools, messages]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("message") as HTMLInputElement | null;
    const text = input?.value.trim();
    if (!text || !connected || busy) return;
    sendMessage({ text });
    if (input) input.value = "";
  }

  function onClearHistory() {
    if (messages.length === 0) return;
    if (window.confirm("Clear this agent's persisted conversation history?")) {
      clearHistory();
    }
  }

  function onRetry() {
    if (!connected || busy || messages.length === 0) return;
    clearError();
    void Promise.resolve(regenerate()).catch((retryError: unknown) => {
      console.error("[useAgentChat] Retry failed", retryError);
    });
  }

  function approveToolAlways(toolName: string, approvalId?: string) {
    const preferenceKey = toolApprovalPreferenceKey(toolName);

    setAlwaysAllowedTools((previous) => {
      if (previous.has(preferenceKey)) return previous;
      const next = new Set(previous);
      next.add(preferenceKey);
      writeAlwaysAllowedTools(next);
      return next;
    });

    if (approvalId && !autoApprovedApprovalIdsRef.current.has(approvalId)) {
      autoApprovedApprovalIdsRef.current.add(approvalId);
      addToolApprovalResponse({ id: approvalId, approved: true });
    }
  }

  function onClearToolAllowlist() {
    const next = new Set<string>();
    writeAlwaysAllowedTools(next);
    setAlwaysAllowedTools(next);
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="mark">ot</div>
          <div>
            <strong>{clientConfig.agentName}</strong>
            <small>{clientConfig.deploymentId}</small>
          </div>
        </div>
        <div className="status-strip" aria-label="Agent status">
          <span className="pill" data-state={connectionState.toLowerCase()}>{connectionState}</span>
          <span className="pill" data-state={status}>{activityLabel}</span>
          {pendingApprovalCount > 0 ? (
            <span className="pill" data-state="waiting-approval">{pendingApprovalCount} approval pending</span>
          ) : null}
          <span className="pill">AIChatAgent WebSocket</span>
        </div>
      </header>

      <section className="workspace" aria-label="Personal agent workspace">
        <section className="chat-panel" aria-busy={busy} aria-label="Chat">
          <div className="panel-header">
            <h1>Conversation</h1>
            <p>Streaming, message persistence, client tools, and approvals are handled by Cloudflare Agents SDK.</p>
          </div>

          <div className="message-list" aria-live="polite" role="log">
            {messages.length === 0 ? (
              <div className="empty-state">
                Ask for a plan, a Cloudflare operation, a memory lookup, or your browser timezone.
              </div>
            ) : (
              messages.map((message) => (
                <Message
                  addToolApprovalResponse={addToolApprovalResponse}
                  approveToolAlways={approveToolAlways}
                  key={message.id}
                  message={message}
                />
              ))
            )}
            {error ? (
              <div className="error" role="alert">
                <span>{error.message}</span>
                <div className="button-row">
                  <button className="button button-compact" onClick={clearError} type="button">
                    Dismiss
                  </button>
                  {messages.length > 0 ? (
                    <button
                      className="button button-compact"
                      disabled={!connected || busy}
                      onClick={onRetry}
                      type="button"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div ref={messageListEndRef} />
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <input
              aria-label="Message"
              autoComplete="off"
              disabled={!connected}
              name="message"
              placeholder={connected ? "Ask your agent to inspect, remember, plan, or operate..." : "Reconnect to continue..."}
            />
            <button className="button button-primary" disabled={!connected || busy} type="submit">
              {busy ? "Working" : "Send"}
            </button>
          </form>
        </section>

        <aside className="side-panel" aria-label="Runtime details">
          <div className="panel-header">
            <h2>Runtime</h2>
            <p>Native SDK chat channel for this deployed agent.</p>
          </div>
          <div className="side-body">
            <Metric label="Transport" value="useAgent WebSocket" />
            <Metric label="Chat lifecycle" value="useAgentChat" />
            <Metric label="Model" value={clientConfig.defaultModel} />
            <Metric label="MCP policy" value={formatToolApprovalPolicy(clientConfig.toolApprovalPolicy)} />
            <Metric label="History" value="SQLite persisted" />
            <Metric label="MCP servers" value={formatMcpStatus(mcpReadyCount, mcpServerValues.length)} />
            <Metric label="Approvals" value={pendingApprovalCount ? `${pendingApprovalCount} pending` : "None pending"} />
            <Metric label="Tool allowlist" value={formatToolAllowlist(alwaysAllowedToolCount)} />
            <div className="button-row">
              {busy ? (
                <button className="button" onClick={stop} type="button">
                  Stop
                </button>
              ) : null}
              <button
                className="button"
                disabled={connected || agent.readyState === WebSocket.CONNECTING}
                onClick={() => agent.reconnect()}
                type="button"
              >
                Reconnect
              </button>
            </div>
            {alwaysAllowedToolCount > 0 ? (
              <button className="button" onClick={onClearToolAllowlist} type="button">
                Clear tool allowlist
              </button>
            ) : null}
            <button className="button button-danger" disabled={messages.length === 0} onClick={onClearHistory} type="button">
              Clear history
            </button>
          </div>
        </aside>
      </section>
    </>
  );
}

function Message({
  addToolApprovalResponse,
  approveToolAlways,
  message
}: {
  addToolApprovalResponse: (input: { id: string; approved: boolean }) => void;
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  message: UIMessage;
}) {
  return (
    <article className="message" data-role={message.role}>
      <small>{message.role}</small>
      {message.parts.map((part, index) => (
        <MessagePart
          addToolApprovalResponse={addToolApprovalResponse}
          approveToolAlways={approveToolAlways}
          key={partKey(part, index)}
          part={part}
        />
      ))}
    </article>
  );
}

function MessagePart({
  addToolApprovalResponse,
  approveToolAlways,
  part
}: {
  addToolApprovalResponse: (input: { id: string; approved: boolean }) => void;
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  part: UIMessage["parts"][number];
}) {
  if (isTextUIPart(part)) {
    return (
      <div className="text-part">
        <Suspense fallback={<p>{part.text}</p>}>
          <MarkdownRenderer>{part.text}</MarkdownRenderer>
        </Suspense>
      </div>
    );
  }

  if (isToolUIPart(part)) {
    const toolCallId = getToolCallId(part);
    const state = getToolPartState(part);
    const toolName = getToolName(part);
    const input = getToolInput(part);
    const output = getToolOutput(part);
    const approval = getToolApproval(part);

    return (
      <div className="tool-part" data-state={state}>
        <div className="tool-heading">
          <strong>{toolName}</strong>
          <span className="pill" data-state={state}>{state}</span>
        </div>
        {input ? <pre>{formatJson(input)}</pre> : null}
        {state === "waiting-approval" ? (
          <>
            <p className="tool-note">
              {approval
                ? "Auto asks for risky or unknown MCP tools. Approve once, always allow this tool in this browser, or reject."
                : "This tool is waiting for approval, but no approval ID was provided."}
            </p>
            <div className="tool-actions">
              <button
                className="button button-primary"
                disabled={!approval?.id}
                onClick={() => approval?.id && addToolApprovalResponse({ id: approval.id, approved: true })}
                type="button"
              >
                Approve once
              </button>
              <button
                className="button"
                disabled={!approval?.id}
                onClick={() => approveToolAlways(toolName, approval?.id)}
                type="button"
              >
                Always allow tool
              </button>
              <button
                className="button"
                disabled={!approval?.id}
                onClick={() => approval?.id && addToolApprovalResponse({ id: approval.id, approved: false })}
                type="button"
              >
                Reject
              </button>
            </div>
          </>
        ) : null}
        {state === "denied" ? <p className="tool-note">Rejected by owner.</p> : null}
        {output ? (
          <>
            <span className="tool-output-label">Output</span>
            <pre>{formatJson(output)}</pre>
          </>
        ) : null}
      </div>
    );
  }

  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function browserTimeContext() {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    localTime: new Date().toLocaleString()
  };
}

const alwaysAllowedToolsStorageKey = "open-think:always-allowed-tools";

function toolApprovalPreferenceKey(toolName: string): string {
  return toolName.replace(/^tool_[a-z0-9]+_/i, "") || toolName;
}

function readAlwaysAllowedTools(): Set<string> {
  if (typeof window === "undefined") return new Set();

  try {
    const raw = window.localStorage.getItem(alwaysAllowedToolsStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    );
  } catch {
    return new Set();
  }
}

function writeAlwaysAllowedTools(tools: Set<string>) {
  try {
    window.localStorage.setItem(alwaysAllowedToolsStorageKey, JSON.stringify([...tools].sort()));
  } catch {
    // Ignore storage failures so approvals still work in private or restricted browsers.
  }
}

function readyStateLabel(value: number) {
  if (value === WebSocket.OPEN) return "Connected";
  if (value === WebSocket.CONNECTING) return "Connecting";
  if (value === WebSocket.CLOSING) return "Closing";
  return "Disconnected";
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

type McpServerState = {
  connectionState?: string;
  state?: string;
  tools?: unknown[];
};

function countPendingApprovals(messages: UIMessage[]) {
  return messages.reduce(
    (total, message) =>
      total +
      message.parts.filter((part) => isToolUIPart(part) && getToolPartState(part) === "waiting-approval")
        .length,
    0
  );
}

function isMcpReady(server: McpServerState) {
  const state = String(server.connectionState ?? server.state ?? "").toLowerCase();
  return state === "ready" || state === "connected";
}

function formatMcpStatus(readyCount: number, totalCount: number) {
  if (totalCount === 0) return "Starting";
  return `${readyCount}/${totalCount} ready`;
}

function formatToolApprovalPolicy(policy: string) {
  if (policy === "ask-every-time") return "Ask every time";
  if (policy === "allow-all") return "Allow all";
  return "Auto";
}

function formatToolAllowlist(count: number) {
  if (count === 0) return "None";
  return `${count} local ${count === 1 ? "rule" : "rules"}`;
}

function partKey(part: UIMessage["parts"][number], index: number) {
  if (isToolUIPart(part)) return getToolCallId(part);
  return String(index);
}

createRoot(document.getElementById("root")!).render(<App />);
