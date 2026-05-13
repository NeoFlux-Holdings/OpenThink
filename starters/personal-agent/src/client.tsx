import { FormEvent, KeyboardEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
      return <Streamdown controls={false}>{children}</Streamdown>;
    }
  };
});

const clientConfig = {
  agentName: "Personal Agent",
  deploymentId: "local",
  defaultModel: "@cf/moonshotai/kimi-k2.6",
  toolApprovalPolicy: "auto",
  sdkPackage: "@open-think/core",
  sdkFactory: "createHostedCloudAgentClient"
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
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<Set<string>>(() => readAlwaysAllowedTools());
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState("");
  const [subAgentMessages, setSubAgentMessages] = useState<SubAgentMessage[]>([]);
  const [subAgentAction, setSubAgentAction] = useState<SubAgentAction | null>(null);
  const [subAgentError, setSubAgentError] = useState<string | null>(null);
  const [subAgentDraft, setSubAgentDraft] = useState<SubAgentDraft>(defaultSubAgentDraft);
  const [sdkCopied, setSdkCopied] = useState(false);
  const [sessionApprovalIds, setSessionApprovalIds] = useState<Set<string>>(() => new Set());
  const [pendingUserMessage, setPendingUserMessage] = useState<PendingUserMessage | null>(null);
  const [pendingAssistantMessage, setPendingAssistantMessage] = useState<PendingAssistantMessage | null>(null);
  const autoApprovedApprovalIdsRef = useRef<Set<string>>(new Set());
  const pendingManualContinuationRef = useRef(false);
  const toolContinuationAttemptSignaturesRef = useRef<Set<string>>(new Set());
  const sessionTurnStartIndexRef = useRef<number | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const handleMcpUpdate = useCallback((servers: unknown) => {
    setMcpServers((previous) => {
      const next = normalizeMcpServers(servers);
      return mcpServerSnapshotsEqual(previous, next) ? previous : next;
    });
  }, []);

  const agent = useAgent({
    agent: "PersonalChatAgent",
    name: "default",
    onMcpUpdate: handleMcpUpdate
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
    autoContinueAfterToolResult: false,
    resume: false,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName !== "getUserTimezone") return;

      addToolOutput({
        toolCallId: toolCall.toolCallId,
        output: browserTimeContext()
      });
      writePendingToolContinuationMarker({ toolCallId: toolCall.toolCallId });
      pendingManualContinuationRef.current = true;
    }
  });

  const connectionState = readyStateLabel(agent.readyState);
  const connected = agent.readyState === WebSocket.OPEN;
  const busy = status === "submitted" || status === "streaming" || isStreaming || isServerStreaming;
  const mcpServerValues = Object.values(mcpServers);
  const mcpReadyCount = mcpServerValues.filter((server) => isMcpReady(server)).length;
  const alwaysAllowedToolCount = alwaysAllowedTools.size;
  const activityLabel = busy ? (isToolContinuation ? "Continuing tool" : "Streaming") : "Idle";
  const activeApprovalIds = sessionApprovalIds;
  const approvalToolCallIds = useMemo(
    () => indexActivePendingApprovals(messages, activeApprovalIds),
    [messages, activeApprovalIds]
  );
  const visibleMessages = useMemo(() => compactVisibleMessages(messages, activeApprovalIds), [messages, activeApprovalIds]);
  const pendingApprovalCount = approvalToolCallIds.size;
  const approvalErrorMessage = formatChatErrorMessage(error);
  const retryIsSafe = !isProtocolRecoveryError(error);
  const canRetry =
    connected &&
    !busy &&
    retryIsSafe &&
    pendingApprovalCount === 0 &&
    messages.some((message) => message.role === "user");
  const selectedSubAgent = subAgents.find((subAgent) => subAgent.id === selectedSubAgentId) ?? subAgents[0] ?? null;
  const activeSubAgentCount = subAgents.filter((subAgent) => subAgent.status !== "archived").length;
  const subAgentBusy = subAgentAction !== null;
  const executionState = runtimeHealth?.cloudAgentInstance?.execution;
  const showAssistantPlaceholder = pendingAssistantMessage !== null && pendingApprovalCount === 0;
  const assistantPlaceholderText = busy ? "Working..." : "No assistant output was received.";

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !stickToBottomRef.current) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, status, isStreaming, isServerStreaming]);

  useEffect(() => {
    void loadSubAgents();
    void loadRuntimeHealth();
  }, []);

  useEffect(() => {
    if (!selectedSubAgent?.id) {
      setSubAgentMessages([]);
      return;
    }
    void loadSubAgentMessages(selectedSubAgent.id);
  }, [selectedSubAgent?.id]);

  useEffect(() => {
    const startIndex = sessionTurnStartIndexRef.current;
    if (startIndex === null) return;

    const nextApprovalIds = indexPendingApprovalIdsAfter(messages, startIndex);
    if (nextApprovalIds.size === 0) return;
    setSessionApprovalIds((previous) => (stringSetsEqual(previous, nextApprovalIds) ? previous : nextApprovalIds));
  }, [messages]);

  useEffect(() => {
    if (!pendingUserMessage) return;
    if (messagesContainUserTextAfter(messages, pendingUserMessage.text, pendingUserMessage.startIndex)) {
      setPendingUserMessage(null);
    }
  }, [messages, pendingUserMessage]);

  useEffect(() => {
    if (!pendingAssistantMessage) return;
    if (messagesContainRenderableAssistantAfter(messages, pendingAssistantMessage.startIndex, sessionApprovalIds)) {
      setPendingAssistantMessage(null);
    }
  }, [messages, pendingAssistantMessage, sessionApprovalIds]);

  useEffect(() => {
    if (!error) return;
    setPendingUserMessage(null);
    setPendingAssistantMessage(null);
  }, [error]);

  useEffect(() => {
    if (!connected || pendingApprovalCount > 0 || hasUnsettledToolInput(messages)) return;

    const recoveredContinuation = pendingManualContinuationRef.current
      ? null
      : toolContinuationCandidate(messages);
    if (!pendingManualContinuationRef.current && !recoveredContinuation) return;
    if (
      recoveredContinuation &&
      (!pendingToolContinuationMarkerMatches(recoveredContinuation, readPendingToolContinuationMarker()) ||
        toolContinuationAttemptSignaturesRef.current.has(recoveredContinuation.signature))
    ) {
      return;
    }

    pendingManualContinuationRef.current = false;
    if (recoveredContinuation) {
      toolContinuationAttemptSignaturesRef.current.add(recoveredContinuation.signature);
      clearPendingToolContinuationMarker();
    }
    stickToBottomRef.current = true;
    void Promise.resolve(sendMessage()).catch((continuationError: unknown) => {
      console.error("[useAgentChat] Manual tool continuation failed", continuationError);
    });
  }, [connected, messages, pendingApprovalCount, sendMessage]);

  function onMessageListScroll() {
    const messageList = messageListRef.current;
    if (!messageList) return;
    stickToBottomRef.current = isNearScrollBottom(messageList);
  }

  const respondToToolApproval = useCallback(
    (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => {
      if (!approvalId || !toolCallId) return false;
      if (approvalToolCallIds.get(approvalId) !== toolCallId) {
        console.warn("[open-think] Ignoring stale tool approval " + approvalId + ".");
        return false;
      }
      if (agent.readyState !== WebSocket.OPEN) {
        console.warn("[open-think] Cannot send tool approval while the agent socket is not connected.");
        return false;
      }

      clearError();
      try {
        void Promise.resolve(addToolApprovalResponse({ id: approvalId, approved })).catch((approvalError: unknown) => {
          console.warn("[open-think] Failed to send tool approval.", approvalError);
        });
        writePendingToolContinuationMarker({ approvalId, toolCallId });
        pendingManualContinuationRef.current = true;
      } catch (approvalError) {
        console.warn("[open-think] Failed to send tool approval.", approvalError);
        return false;
      }
      return true;
    },
    [addToolApprovalResponse, agent.readyState, approvalToolCallIds, clearError]
  );

  useEffect(() => {
    if (!connected) return;

    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

        const approval = getToolApproval(part);
        const toolCallId = getToolCallId(part);
        const toolName = getToolName(part);
        if (!approval?.id || approvalToolCallIds.get(approval.id) !== toolCallId) continue;
        if (!alwaysAllowedTools.has(toolApprovalPreferenceKey(toolName))) continue;
        if (autoApprovedApprovalIdsRef.current.has(approval.id)) continue;

        if (respondToToolApproval(approval.id, toolCallId, true)) {
          autoApprovedApprovalIdsRef.current.add(approval.id);
        }
      }
    }
  }, [alwaysAllowedTools, approvalToolCallIds, connected, messages, respondToToolApproval]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("message") as HTMLTextAreaElement | null;
    const text = input?.value.trim();
    if (!text || !connected || busy) return;
    clearError();
    clearPendingToolContinuationMarker();
    sessionTurnStartIndexRef.current = messages.length;
    setSessionApprovalIds(new Set());
    setPendingUserMessage({
      text,
      startIndex: messages.length
    });
    setPendingAssistantMessage({
      startIndex: messages.length
    });
    stickToBottomRef.current = true;
    sendMessage({ text });
    if (input) input.value = "";
  }

  function onClearHistory() {
    if (messages.length === 0) return;
    if (window.confirm("Clear this agent's persisted conversation history?")) {
      clearPendingToolContinuationMarker();
      sessionTurnStartIndexRef.current = null;
      setSessionApprovalIds(new Set());
      setPendingUserMessage(null);
      setPendingAssistantMessage(null);
      clearHistory();
    }
  }

  function onRetry() {
    if (!canRetry) return;
    clearError();
    stickToBottomRef.current = true;
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
      const toolCallId = approvalToolCallIds.get(approvalId);
      if (respondToToolApproval(approvalId, toolCallId, true)) {
        autoApprovedApprovalIdsRef.current.add(approvalId);
      }
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function onClearToolAllowlist() {
    const next = new Set<string>();
    writeAlwaysAllowedTools(next);
    setAlwaysAllowedTools(next);
  }

  async function loadSubAgents(preferredId?: string) {
    try {
      const data = await jsonFetch<{ available?: boolean; subAgents?: SubAgent[]; error?: string }>("/subagents");
      const nextSubAgents = data.subAgents ?? [];
      setSubAgents(nextSubAgents);
      setSelectedSubAgentId((current) => preferredId || current || nextSubAgents[0]?.id || "");
      setSubAgentError(data.available === false && data.error ? data.error : null);
    } catch (loadError) {
      setSubAgentError(loadError instanceof Error ? loadError.message : "Could not load sub-agents.");
    }
  }

  async function loadRuntimeHealth() {
    try {
      const data = await jsonFetch<RuntimeHealth>("/health");
      setRuntimeHealth(data);
    } catch {
      setRuntimeHealth(null);
    }
  }

  async function loadSubAgentMessages(id: string) {
    try {
      const data = await jsonFetch<{ messages?: SubAgentMessage[] }>("/subagents/" + encodeURIComponent(id) + "/messages");
      setSubAgentMessages(data.messages ?? []);
    } catch (loadError) {
      setSubAgentError(loadError instanceof Error ? loadError.message : "Could not load sub-agent messages.");
    }
  }

  async function onCreateSubAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubAgentAction("create");
    setSubAgentError(null);
    try {
      const result = await jsonFetch<{ subAgent?: SubAgent }>("/subagents", {
        method: "POST",
        body: JSON.stringify({
          ...subAgentDraft,
          skills: subAgentDraft.skills.split(",").map((skill) => skill.trim()).filter(Boolean)
        })
      });
      if (result.subAgent) {
        setSubAgentDraft(defaultSubAgentDraft);
        await loadSubAgents(result.subAgent.id);
      }
    } catch (createError) {
      setSubAgentError(createError instanceof Error ? createError.message : "Could not create sub-agent.");
    } finally {
      setSubAgentAction(null);
    }
  }

  async function controlSubAgent(status: SubAgentStatus) {
    if (!selectedSubAgent) return;
    setSubAgentAction(status === "paused" ? "pause" : status === "archived" ? "archive" : "resume");
    setSubAgentError(null);
    try {
      await jsonFetch("/subagents/" + encodeURIComponent(selectedSubAgent.id) + "/control", {
        method: "POST",
        body: JSON.stringify({ status })
      });
      await loadSubAgents(selectedSubAgent.id);
    } catch (controlError) {
      setSubAgentError(controlError instanceof Error ? controlError.message : "Could not update sub-agent.");
    } finally {
      setSubAgentAction(null);
    }
  }

  async function refreshSubAgentSummary() {
    if (!selectedSubAgent) return;
    setSubAgentAction("summarize");
    setSubAgentError(null);
    try {
      await jsonFetch("/subagents/" + encodeURIComponent(selectedSubAgent.id) + "/summary", { method: "POST" });
      await loadSubAgents(selectedSubAgent.id);
    } catch (summaryError) {
      setSubAgentError(summaryError instanceof Error ? summaryError.message : "Could not refresh summary.");
    } finally {
      setSubAgentAction(null);
    }
  }

  async function sendSubAgentText(prompt: string, action: SubAgentAction = "send"): Promise<boolean> {
    if (!selectedSubAgent) return false;
    setSubAgentAction(action);
    setSubAgentError(null);
    try {
      const result = await jsonFetch<{ subAgent?: SubAgent; messages?: SubAgentMessage[] }>(
        "/subagents/" + encodeURIComponent(selectedSubAgent.id) + "/messages",
        { method: "POST", body: JSON.stringify({ message: prompt }) }
      );
      if (result.messages) setSubAgentMessages(result.messages);
      await loadSubAgents(result.subAgent?.id || selectedSubAgent.id);
      return true;
    } catch (sendError) {
      setSubAgentError(sendError instanceof Error ? sendError.message : "Could not message sub-agent.");
      return false;
    } finally {
      setSubAgentAction(null);
    }
  }

  async function sendSubAgentPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("subAgentPrompt") as HTMLTextAreaElement | null;
    const prompt = input?.value.trim();
    if (!prompt) return;
    if (await sendSubAgentText(prompt, "send")) {
      if (input) input.value = "";
    }
  }

  function exploreSelectedSubAgent() {
    if (!selectedSubAgent || subAgentBusy) return;
    void sendSubAgentText(subAgentExplorePrompt, "explore");
  }

  async function copySdkSnippet() {
    const snippet = hostedAgentSdkSnippet();
    try {
      await navigator.clipboard.writeText(snippet);
      setSdkCopied(true);
      window.setTimeout(() => setSdkCopied(false), 1800);
    } catch {
      setSdkCopied(false);
    }
  }

  function briefSubAgentInMainChat() {
    if (!selectedSubAgent || !connected || busy) return;
    sendMessage({
      text:
        "Review sub-agent " +
        selectedSubAgent.name +
        " (" +
        selectedSubAgent.status +
        "). Purpose: " +
        selectedSubAgent.purpose +
        "\n\nCurrent summary: " +
        selectedSubAgent.summary
    });
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

          <div className="message-list" aria-live="polite" onScroll={onMessageListScroll} ref={messageListRef} role="log">
            {visibleMessages.length === 0 ? (
              <div className="empty-state">
                Use /goal to set an active objective, or ask for a plan, a Cloudflare operation, a memory lookup, or your browser timezone.
              </div>
            ) : (
              visibleMessages.map(({ key, message }) => (
                <Message
                  activeApprovalIds={activeApprovalIds}
                  approveToolAlways={approveToolAlways}
                  key={key}
                  message={message}
                  respondToToolApproval={respondToToolApproval}
                />
              ))
            )}
            {pendingUserMessage ? <PendingMessage role="user" text={pendingUserMessage.text} /> : null}
            {showAssistantPlaceholder ? <PendingMessage role="assistant" text={assistantPlaceholderText} /> : null}
            {approvalErrorMessage ? (
              <div className="error" role="alert">
                <span>{approvalErrorMessage}</span>
                <div className="button-row">
                  <button className="button button-compact" onClick={clearError} type="button">
                    Dismiss
                  </button>
                  {messages.length > 0 && pendingApprovalCount === 0 ? (
                    <button
                      className="button button-compact"
                      disabled={!canRetry}
                      onClick={onRetry}
                      type="button"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <textarea
              aria-label="Message"
              autoComplete="off"
              disabled={!connected}
              name="message"
              onKeyDown={onComposerKeyDown}
              placeholder={connected ? "Ask, or start with /goal to set an active objective..." : "Reconnect to continue..."}
              rows={1}
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
            <Metric label="Executor MCP" value={formatExecutionPlane(executionState?.executor)} />
            <Metric label="Sandbox" value={formatExecutionPlane(executionState?.sandbox)} />
            <Metric label="Containers" value={formatExecutionPlane(executionState?.containers)} />
            <Metric label="Slash commands" value="/goal enabled" />
            <Metric label="Sub-agents" value={subAgents.length ? `${activeSubAgentCount}/${subAgents.length} active` : "None"} />
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
            <HostedAgentPanel copied={sdkCopied} onCopy={copySdkSnippet} />
            <SubAgentConsole
              briefSubAgentInMainChat={briefSubAgentInMainChat}
              connected={connected}
              controlSubAgent={controlSubAgent}
              draft={subAgentDraft}
              error={subAgentError}
              loading={subAgentBusy}
              mainBusy={busy}
              messages={subAgentMessages}
              onCreate={onCreateSubAgent}
              onDraftChange={setSubAgentDraft}
              onExplore={exploreSelectedSubAgent}
              onRefreshSummary={refreshSubAgentSummary}
              onSelect={setSelectedSubAgentId}
              onSendMessage={sendSubAgentPrompt}
              selected={selectedSubAgent}
              loadingAction={subAgentAction}
              subAgents={subAgents}
            />
          </div>
        </aside>
      </section>
    </>
  );
}

function Message({
  activeApprovalIds,
  approveToolAlways,
  message,
  respondToToolApproval
}: {
  activeApprovalIds: ReadonlySet<string>;
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  message: UIMessage;
  respondToToolApproval: (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => boolean;
}) {
  const parts = compactMessageParts(message.parts).filter(({ part }) => partHasVisibleContent(part, activeApprovalIds));
  if (parts.length === 0) return null;
  const blocks = messageRenderBlocks(parts);

  return (
    <article className="message" data-role={message.role}>
      <small>{message.role}</small>
      {blocks.map((block) =>
        block.kind === "tool-group" ? (
          <ToolPartGroup
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={block.key}
            parts={block.parts}
            respondToToolApproval={respondToToolApproval}
          />
        ) : (
          <MessagePart
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={block.key}
            part={block.part}
            respondToToolApproval={respondToToolApproval}
          />
        )
      )}
    </article>
  );
}

function shouldRenderMessagePart(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  if (!isToolUIPart(part)) return true;

  const approval = getToolApproval(part);
  if (!approval?.id || activeApprovalIds.has(approval.id)) return true;

  const stateKey = String(getToolPartState(part));
  return stateKey !== "waiting-approval" && stateKey !== "approved" && stateKey !== "approval-responded";
}

function ToolPartGroup({
  activeApprovalIds,
  approveToolAlways,
  parts,
  respondToToolApproval
}: {
  activeApprovalIds: ReadonlySet<string>;
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  parts: MessagePartEntry[];
  respondToToolApproval: (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => boolean;
}) {
  const summary = summarizeToolGroup(parts, activeApprovalIds);

  return (
    <details className="tool-group" data-state={summary.state} open={summary.defaultOpen ? true : undefined}>
      <summary>
        <span className="tool-group-title">
          <strong>{summary.title}</strong>
          <small>{summary.detail}</small>
        </span>
        <span className="tool-group-meta">
          <span className="pill" data-state={summary.state}>{summary.state}</span>
          <span className="tool-group-toggle">Details</span>
        </span>
      </summary>
      <div className="tool-group-details">
        {parts.map(({ part, index }) => (
          <MessagePart
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={partKey(part, index)}
            part={part}
            respondToToolApproval={respondToToolApproval}
          />
        ))}
      </div>
    </details>
  );
}

function MessagePart({
  activeApprovalIds,
  approveToolAlways,
  part,
  respondToToolApproval
}: {
  activeApprovalIds: ReadonlySet<string>;
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  part: UIMessage["parts"][number];
  respondToToolApproval: (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => boolean;
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
    const stateKey = String(state);
    const isApprovalState = stateKey === "waiting-approval" || stateKey === "approved" || stateKey === "approval-responded";
    const approvalIsActive = toolPartHasActiveApproval(part, activeApprovalIds);
    const displayState = toolPartDisplayState(part, activeApprovalIds);
    const canRespondToApproval = Boolean(approval?.id && toolCallId && approvalIsActive);
    const showToolPayload = displayState !== "expired-approval";

    return (
      <div className="tool-part" data-state={displayState}>
        <div className="tool-heading">
          <strong>{toolName}</strong>
          <span className="pill" data-state={displayState}>{displayState}</span>
        </div>
        {input && showToolPayload ? <pre>{formatJson(input)}</pre> : null}
        {state === "waiting-approval" && approvalIsActive ? (
          <>
            <p className="tool-note">
              {approval
                ? "Auto asks for risky or unknown MCP tools. Approve once, always allow this tool in this browser, or reject."
                : "This tool is waiting for approval, but no approval ID was provided."}
            </p>
            <div className="tool-actions">
              <button
                className="button button-primary"
                disabled={!canRespondToApproval}
                onClick={() => respondToToolApproval(approval?.id, toolCallId, true)}
                type="button"
              >
                Approve once
              </button>
              <button
                className="button"
                disabled={!canRespondToApproval}
                onClick={() => approveToolAlways(toolName, approval?.id)}
                type="button"
              >
                Always allow tool
              </button>
              <button
                className="button"
                disabled={!canRespondToApproval}
                onClick={() => respondToToolApproval(approval?.id, toolCallId, false)}
                type="button"
              >
                Reject
              </button>
            </div>
          </>
        ) : null}
        {isApprovalState && !approvalIsActive ? (
          <p className="tool-note">
            This approval belongs to an older turn and is no longer actionable. Send a new request to run it again.
          </p>
        ) : null}
        {state === "denied" ? <p className="tool-note">Rejected by owner.</p> : null}
        {output && showToolPayload ? (
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

function HostedAgentPanel({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  const origin = typeof window === "undefined" ? "https://your-agent.workers.dev" : window.location.origin;
  return (
    <section className="hosted-agent-panel" aria-label="Hosted Cloud Agent developer flow">
      <div className="section-heading">
        <div>
          <h3>Hosted Agent</h3>
          <p>End-to-end Cloudflare agent surface for app developers and sub-agents.</p>
        </div>
        <span className="pill">SDK</span>
      </div>
      <ol className="flow-list">
        {hostedFlowSteps.map((step) => (
          <li className="flow-step" key={step.title}>
            <span>{step.index}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="sdk-card">
        <div>
          <strong>{clientConfig.sdkPackage}</strong>
          <small>{clientConfig.sdkFactory}({"{ baseUrl }"})</small>
        </div>
        <button className="button button-compact" onClick={onCopy} type="button">
          {copied ? "Copied" : "Copy SDK snippet"}
        </button>
      </div>
      <pre className="sdk-snippet">{hostedAgentSdkSnippet(origin)}</pre>
      <div className="customization-grid" aria-label="Customization options">
        <Metric label="Personal agent" value="Prompt, brain, skills" />
        <Metric label="Sub-agents" value="Purpose, mode, model" />
        <Metric label="Runtime" value="Model, approvals, executor" />
      </div>
    </section>
  );
}

function SubAgentConsole({
  briefSubAgentInMainChat,
  connected,
  controlSubAgent,
  draft,
  error,
  loading,
  mainBusy,
  messages,
  onCreate,
  onDraftChange,
  onExplore,
  onRefreshSummary,
  onSelect,
  onSendMessage,
  selected,
  loadingAction,
  subAgents
}: {
  briefSubAgentInMainChat: () => void;
  connected: boolean;
  controlSubAgent: (status: SubAgentStatus) => void;
  draft: SubAgentDraft;
  error: string | null;
  loading: boolean;
  mainBusy: boolean;
  messages: SubAgentMessage[];
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: SubAgentDraft) => void;
  onExplore: () => void;
  onRefreshSummary: () => void;
  onSelect: (id: string) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  selected: SubAgent | null;
  loadingAction: SubAgentAction | null;
  subAgents: SubAgent[];
}) {
  const readyCount = subAgents.filter((subAgent) => subAgent.status === "ready").length;
  const workingCount = subAgents.filter((subAgent) => subAgent.status === "working").length;
  const pausedCount = subAgents.filter((subAgent) => subAgent.status === "paused").length;

  return (
    <section className="subagent-console" aria-label="Sub-agent console">
      <div className="section-heading">
        <div>
          <h3>Agent Workstreams</h3>
          <p>Create focused child agents, track their state, and pull useful briefs back into chat.</p>
        </div>
        <span className="pill" data-state={subAgents.length ? "ready" : undefined}>{subAgents.length}</span>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      <div className="workstream-stats" aria-label="Sub-agent status counts">
        <Metric label="Ready" value={String(readyCount)} />
        <Metric label="Working" value={String(workingCount)} />
        <Metric label="Paused" value={String(pausedCount)} />
      </div>

      <div className="subagent-templates" aria-label="Sub-agent templates">
        {subAgentTemplates.map((template) => (
          <button
            className="subagent-template"
            key={template.id}
            onClick={() => onDraftChange({ ...draft, ...template.draft })}
            type="button"
          >
            <strong>{template.label}</strong>
            <small>{template.summary}</small>
          </button>
        ))}
      </div>

      <form className="subagent-create" onSubmit={onCreate}>
        <strong className="form-kicker">New delegated workstream</strong>
        <input
          aria-label="Sub-agent name"
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
          placeholder="Sub-agent name"
          value={draft.name}
        />
        <textarea
          aria-label="Sub-agent purpose"
          onChange={(event) => onDraftChange({ ...draft, purpose: event.target.value })}
          placeholder="Mission or responsibility"
          rows={2}
          value={draft.purpose}
        />
        <div className="field-grid">
          <select
            aria-label="Sub-agent mode"
            onChange={(event) => onDraftChange({ ...draft, mode: event.target.value as SubAgentMode })}
            value={draft.mode}
          >
            <option value="hybrid">Hybrid</option>
            <option value="agents-sdk">Agents SDK</option>
            <option value="executor">Executor</option>
          </select>
          <input
            aria-label="Sub-agent brain"
            onChange={(event) => onDraftChange({ ...draft, brain: event.target.value })}
            placeholder="Brain"
            value={draft.brain}
          />
        </div>
        <input
          aria-label="Sub-agent model"
          onChange={(event) => onDraftChange({ ...draft, model: event.target.value })}
          placeholder="Model override, optional"
          value={draft.model}
        />
        <input
          aria-label="Sub-agent skills"
          onChange={(event) => onDraftChange({ ...draft, skills: event.target.value })}
          placeholder="skills, comma separated"
          value={draft.skills}
        />
        <textarea
          aria-label="Sub-agent system prompt"
          onChange={(event) => onDraftChange({ ...draft, systemPrompt: event.target.value })}
          placeholder="Optional custom system prompt"
          rows={2}
          value={draft.systemPrompt}
        />
        <button className="button button-primary button-block" disabled={loading || !draft.name.trim() || !draft.purpose.trim()} type="submit">
          {loadingAction === "create" ? "Creating" : "Create sub-agent"}
        </button>
      </form>

      <div className="subagent-roster" aria-label="Tracked sub-agents">
        {subAgents.length ? (
          subAgents.map((subAgent) => (
            <button
              className="subagent-row"
              data-active={String(selected?.id === subAgent.id)}
              key={subAgent.id}
              onClick={() => onSelect(subAgent.id)}
              type="button"
            >
              <span>
                <strong>{subAgent.name}</strong>
                <small>{subAgent.mode} / {subAgent.brain}</small>
              </span>
              <span className="pill" data-state={subAgent.status}>{subAgent.status}</span>
            </button>
          ))
        ) : (
          <div className="empty-state compact">No sub-agents yet.</div>
        )}
      </div>

      {selected ? (
        <div className="subagent-detail">
          <div className="subagent-summary">
            <div className="detail-title">
              <div>
                <strong>{selected.name}</strong>
                <small>{selected.purpose}</small>
              </div>
              <span className="pill" data-state={selected.status}>{selected.status}</span>
            </div>
            <p>{selected.summary || "No summary yet."}</p>
            <div className="subagent-chip-row" aria-label="Sub-agent traits">
              <span className="pill">{selected.mode}</span>
              <span className="pill">{selected.brain}</span>
              <span className="pill">{selected.model}</span>
              {selected.skills.slice(0, 3).map((skill) => (
                <span className="pill" key={skill}>{skill}</span>
              ))}
            </div>
          </div>
          <div className="subagent-metadata" aria-label="Selected sub-agent metadata">
            <Metric label="Messages" value={String(selected.messageCount ?? messages.length)} />
            <Metric label="Updated" value={formatRelativeTime(selected.updatedAt)} />
            <Metric label="Plane" value={formatSubAgentMode(selected.mode)} />
          </div>
          <div className="button-row">
            <button className="button button-compact" disabled={loading || selected.status === "paused"} onClick={() => controlSubAgent("paused")} type="button">
              {loadingAction === "pause" ? "Pausing" : "Pause"}
            </button>
            <button className="button button-compact" disabled={loading || selected.status === "ready"} onClick={() => controlSubAgent("ready")} type="button">
              {loadingAction === "resume" ? "Resuming" : "Resume"}
            </button>
            <button className="button button-compact" disabled={loading} onClick={onRefreshSummary} type="button">
              {loadingAction === "summarize" ? "Summarizing" : "Summarize"}
            </button>
            <button
              className="button button-compact"
              disabled={loading || selected.status === "paused" || selected.status === "archived"}
              onClick={onExplore}
              type="button"
            >
              {loadingAction === "explore" ? "Exploring" : "Explore"}
            </button>
            <button className="button button-compact" disabled={!connected || mainBusy} onClick={briefSubAgentInMainChat} type="button">
              Brief chat
            </button>
            <button className="button button-compact button-danger" disabled={loading || selected.status === "archived"} onClick={() => controlSubAgent("archived")} type="button">
              {loadingAction === "archive" ? "Archiving" : "Archive"}
            </button>
          </div>
          <div className="subagent-messages" aria-live="polite">
            {messages.length ? (
              messages.slice(-6).map((message) => (
                <div className="subagent-message" data-role={message.role} key={message.id}>
                  <small>{message.role}</small>
                  <p>{message.content}</p>
                </div>
              ))
            ) : (
              <div className="empty-state compact">Send a scoped prompt to start this sub-agent thread.</div>
            )}
          </div>
          <form className="subagent-prompt" onSubmit={onSendMessage}>
            <textarea
              aria-label="Message selected sub-agent"
              disabled={loading || selected.status === "paused" || selected.status === "archived"}
              name="subAgentPrompt"
              placeholder="Ask this sub-agent for a focused pass..."
              rows={2}
            />
            <button className="button button-primary" disabled={loading || selected.status === "paused" || selected.status === "archived"} type="submit">
              {loadingAction === "send" ? "Sending" : "Send"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
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
const pendingToolContinuationStorageKey = "open-think:pending-tool-continuation:" + clientConfig.deploymentId;
const pendingToolContinuationMaxAgeMs = 5 * 60 * 1000;

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

function readPendingToolContinuationMarker(): ToolContinuationMarker | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(pendingToolContinuationStorageKey);
    if (!raw) return null;

    const marker = JSON.parse(raw) as Partial<ToolContinuationMarker>;
    if (!Number.isFinite(marker.createdAt)) return null;
    if (Date.now() - Number(marker.createdAt) > pendingToolContinuationMaxAgeMs) {
      clearPendingToolContinuationMarker();
      return null;
    }

    const toolCallId = typeof marker.toolCallId === "string" ? marker.toolCallId : undefined;
    const approvalId = typeof marker.approvalId === "string" ? marker.approvalId : undefined;
    if (!toolCallId && !approvalId) return null;

    return {
      createdAt: Number(marker.createdAt),
      toolCallId,
      approvalId
    };
  } catch {
    return null;
  }
}

function writePendingToolContinuationMarker(marker: Omit<ToolContinuationMarker, "createdAt">) {
  try {
    window.sessionStorage.setItem(
      pendingToolContinuationStorageKey,
      JSON.stringify({
        ...marker,
        createdAt: Date.now()
      })
    );
  } catch {
    // The in-memory continuation path still handles the current approval click.
  }
}

function clearPendingToolContinuationMarker() {
  try {
    window.sessionStorage.removeItem(pendingToolContinuationStorageKey);
  } catch {
    // Ignore storage failures so chat is never blocked by recovery bookkeeping.
  }
}

function pendingToolContinuationMarkerMatches(
  candidate: ToolContinuationCandidate,
  marker: ToolContinuationMarker | null
) {
  if (!marker) return false;
  if (marker.toolCallId && candidate.toolCallIds.has(marker.toolCallId)) return true;
  if (marker.approvalId && candidate.approvalIds.has(marker.approvalId)) return true;
  return false;
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

type RuntimeHealth = {
  cloudAgentInstance?: {
    execution?: RuntimeExecutionState;
  };
};

type RuntimeExecutionState = {
  executor?: RuntimeExecutionPlane;
  sandbox?: RuntimeExecutionPlane;
  containers?: RuntimeExecutionPlane;
};

type RuntimeExecutionPlane = {
  enabled?: boolean;
  configured?: boolean;
  status?: string;
  default?: boolean;
};

type SubAgentStatus = "ready" | "working" | "paused" | "archived";
type SubAgentMode = "agents-sdk" | "executor" | "hybrid";
type SubAgentAction = "create" | "pause" | "resume" | "archive" | "summarize" | "send" | "explore";

type SubAgentDraft = {
  name: string;
  purpose: string;
  mode: SubAgentMode;
  brain: string;
  model: string;
  skills: string;
  systemPrompt: string;
};

const defaultSubAgentDraft: SubAgentDraft = {
  name: "Research scout",
  purpose: "Investigate one bounded topic and report back with options, risks, and next steps.",
  mode: "hybrid",
  brain: "gbrain + gskills",
  model: "",
  skills: "research, planning, cloudflare",
  systemPrompt: ""
};

const subAgentTemplates = [
  {
    id: "research",
    label: "Research Scout",
    summary: "Read-only discovery, options, risks, next steps.",
    draft: {
      name: "Research scout",
      purpose: "Investigate one bounded topic and report back with options, risks, and next steps.",
      mode: "agents-sdk" as SubAgentMode,
      brain: "gbrain + gskills",
      model: "",
      skills: "research, planning, cloudflare",
      systemPrompt: "Stay read-only. Return concise findings, risks, open questions, and a recommended next action."
    }
  },
  {
    id: "builder",
    label: "Builder",
    summary: "Implementation workstream for scoped code or deploy tasks.",
    draft: {
      name: "Builder",
      purpose: "Implement one scoped change, report touched surfaces, and ask before risky operations.",
      mode: "hybrid" as SubAgentMode,
      brain: "gbrain + executor",
      model: "",
      skills: "coding, tests, cloudflare, executor",
      systemPrompt: "Own a narrow implementation slice. Prefer executor/sandbox for commands when available. Report files, tests, blockers, and next action."
    }
  },
  {
    id: "reviewer",
    label: "Reviewer",
    summary: "Quality gate for bugs, regressions, and missing tests.",
    draft: {
      name: "Reviewer",
      purpose: "Review a completed change for correctness, regression risk, and verification gaps.",
      mode: "agents-sdk" as SubAgentMode,
      brain: "review gbrain",
      model: "",
      skills: "review, testing, security",
      systemPrompt: "Lead with findings ordered by severity. Include exact evidence, residual risk, and recommended fixes."
    }
  },
  {
    id: "operator",
    label: "Cloud Operator",
    summary: "Cloudflare deploy, logs, bindings, and account operations.",
    draft: {
      name: "Cloud operator",
      purpose: "Plan and execute Cloudflare operations with explicit approval for risky account changes.",
      mode: "hybrid" as SubAgentMode,
      brain: "gstack operator",
      model: "",
      skills: "cloudflare, mcp, deploy, observability",
      systemPrompt: "Use Cloudflare MCP for read operations. Ask before writes, deploys, DNS, access, billing, or secret changes."
    }
  }
] as const;

const subAgentExplorePrompt =
  "Give me a current state report: what you know, what you still need, likely risks, and the next concrete action you recommend.";

const hostedFlowSteps = [
  {
    index: "01",
    title: "Design",
    detail: "Choose brain, prompts, skills, model, and approval policy."
  },
  {
    index: "02",
    title: "Deploy",
    detail: "Publish the Worker, Agents SDK runtime, assets, and bindings."
  },
  {
    index: "03",
    title: "Plug in",
    detail: "Use /health, /manifest, /goal, and /subagents from the SDK."
  },
  {
    index: "04",
    title: "Operate",
    detail: "Delegate, summarize, approve tools, and update the agent."
  }
] as const;

function hostedAgentSdkSnippet(baseUrl = "https://your-agent.workers.dev") {
  return [
    'import { createHostedCloudAgentClient } from "@open-think/core";',
    "",
    "const agent = createHostedCloudAgentClient({",
    `  baseUrl: "${baseUrl}"`,
    "});",
    "",
    "const profile = await agent.profile();",
    'await agent.goal("Ship the first customer workflow");',
    "const child = await agent.createSubAgent({",
    '  name: "Deploy scout",',
    '  purpose: "Check deploy readiness and summarize blockers",',
    '  mode: "hybrid",',
    '  skills: ["cloudflare", "release", "testing"]',
    "});",
    'await agent.sendSubAgentMessage(child.subAgent.id, "Inspect the current deploy path.");'
  ].join("\n");
}

type SubAgent = {
  id: string;
  name: string;
  purpose: string;
  status: SubAgentStatus;
  mode: SubAgentMode;
  model: string;
  brain: string;
  systemPrompt: string;
  skills: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
};

type SubAgentMessage = {
  id: string;
  subAgentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type PendingUserMessage = {
  text: string;
  startIndex: number;
};

type PendingAssistantMessage = {
  startIndex: number;
};

type VisibleMessage = {
  key: string;
  message: UIMessage;
};

type MessagePartEntry = {
  part: UIMessage["parts"][number];
  index: number;
};

type MessageRenderBlock =
  | {
      kind: "part";
      key: string;
      part: UIMessage["parts"][number];
    }
  | {
      kind: "tool-group";
      key: string;
      parts: MessagePartEntry[];
    };

type ToolContinuationCandidate = {
  signature: string;
  toolCallIds: Set<string>;
  approvalIds: Set<string>;
};

type ToolContinuationMarker = {
  createdAt: number;
  toolCallId?: string | undefined;
  approvalId?: string | undefined;
};

function messageHasRenderableParts(message: UIMessage) {
  return message.parts.some((part) => isTextUIPart(part) || isToolUIPart(part));
}

function PendingMessage({
  role,
  text
}: {
  role: "user" | "assistant";
  text: string;
}) {
  return (
    <article className="message" data-pending="true" data-role={role}>
      <small>{role}</small>
      <div className="text-part">
        <p>{text}</p>
      </div>
    </article>
  );
}

function messagesContainUserTextAfter(messages: UIMessage[], text: string, startIndex: number) {
  for (let messageIndex = startIndex; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "user") continue;
    if (message.parts.some((part) => isTextUIPart(part) && part.text.trim() === text)) return true;
  }
  return false;
}

function messagesContainRenderableAssistantAfter(
  messages: UIMessage[],
  startIndex: number,
  activeApprovalIds: ReadonlySet<string>
) {
  for (let messageIndex = startIndex; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") continue;
    if (compactMessageParts(message.parts).some(({ part }) => partHasVisibleContent(part, activeApprovalIds))) return true;
  }
  return false;
}

function partHasVisibleContent(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  if (isTextUIPart(part)) return part.text.trim().length > 0;
  if (isToolUIPart(part)) return shouldRenderMessagePart(part, activeApprovalIds);
  return false;
}

function messageRenderBlocks(parts: MessagePartEntry[]): MessageRenderBlock[] {
  const blocks: MessageRenderBlock[] = [];
  let toolGroup: MessagePartEntry[] = [];

  const flushToolGroup = () => {
    if (toolGroup.length === 0) return;
    const groupParts = toolGroup;
    toolGroup = [];
    blocks.push({
      kind: "tool-group",
      key: "tool-group:" + groupParts.map(({ part, index }) => partKey(part, index)).join("|"),
      parts: groupParts
    });
  };

  for (const entry of parts) {
    if (isToolUIPart(entry.part)) {
      toolGroup.push(entry);
      continue;
    }

    flushToolGroup();
    blocks.push({
      kind: "part",
      key: partKey(entry.part, entry.index),
      part: entry.part
    });
  }

  flushToolGroup();
  return blocks;
}

function summarizeToolGroup(parts: MessagePartEntry[], activeApprovalIds: ReadonlySet<string>) {
  const names = uniqueToolNames(parts);
  const states = parts.map(({ part }) => toolSummaryState(part, activeApprovalIds));
  const activeApprovalCount = parts.filter(({ part }) => toolPartHasActiveApproval(part, activeApprovalIds)).length;
  const state = toolGroupState(states, activeApprovalCount);
  const countLabel = parts.length === 1 ? "1 tool call" : parts.length + " tool calls";
  const title = parts.length === 1 ? names[0] ?? "Tool call" : countLabel;
  const detailParts = [parts.length === 1 ? null : formatToolNameList(names), formatToolStateList(states)].filter(Boolean);

  return {
    defaultOpen: activeApprovalCount > 0,
    detail: detailParts.join(" - ") || countLabel,
    state,
    title
  };
}

function uniqueToolNames(parts: MessagePartEntry[]) {
  return Array.from(new Set(parts.flatMap(({ part }) => (isToolUIPart(part) ? [getToolName(part)] : [])).filter(Boolean)));
}

function formatToolNameList(names: string[]) {
  if (names.length <= 2) return names.join(", ");
  return names.slice(0, 2).join(", ") + " +" + String(names.length - 2);
}

function formatToolStateList(states: string[]) {
  const counts = new Map<string, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([state, count]) => (count === 1 ? state : String(count) + " " + state))
    .join(", ");
}

function toolSummaryState(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  const displayState = toolPartDisplayState(part, activeApprovalIds);
  if (displayState === "input-streaming" || displayState === "input-available") return "streaming";
  if (displayState === "output-error") return "error";
  if (displayState === "output-available" || displayState === "approval-responded" || displayState === "approved") return "complete";
  return displayState;
}

function toolGroupState(states: string[], activeApprovalCount: number) {
  if (activeApprovalCount > 0 || states.includes("waiting-approval")) return "waiting-approval";
  if (states.includes("streaming")) return "streaming";
  if (states.includes("error") || states.includes("denied")) return "error";
  if (states.includes("expired-approval")) return "expired-approval";
  if (states.length > 0 && states.every((state) => state === "complete")) return "complete";
  return states[0] ?? "tool";
}

function toolPartDisplayState(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  const state = String((getToolPartState(part) ?? rawToolPartState(part)) || "tool");
  const isApprovalState = state === "waiting-approval" || state === "approved" || state === "approval-responded";
  return isApprovalState && !toolPartHasActiveApproval(part, activeApprovalIds) ? "expired-approval" : state;
}

function toolPartHasActiveApproval(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  const approval = getToolApproval(part);
  return Boolean(approval?.id && activeApprovalIds.has(approval.id));
}

function compactMessageParts(parts: UIMessage["parts"]) {
  const seenToolIds = new Set<string>();
  const visibleParts: MessagePartEntry[] = [];

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part) continue;

    if (isToolUIPart(part)) {
      const toolPartId = getToolCallId(part) ?? getToolApproval(part)?.id;
      if (toolPartId) {
        if (seenToolIds.has(toolPartId)) continue;
        seenToolIds.add(toolPartId);
      }
    }

    visibleParts.push({ part, index });
  }

  return visibleParts.reverse();
}

function latestRenderableAssistantTurn(messages: UIMessage[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) continue;
    if (message.role === "user") return null;
    if (message.role === "assistant" && messageHasRenderableParts(message)) {
      return { message, messageIndex };
    }
  }
  return null;
}

function compactVisibleMessages(messages: UIMessage[], activeApprovalIds: ReadonlySet<string>) {
  const seenSnapshots = new Set<string>();
  const visible: VisibleMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !message.parts.some((part) => partHasVisibleContent(part, activeApprovalIds))) continue;

    const messageId = message.id || `${message.role}:${index}`;
    const snapshotKey = `${messageId}:${message.role}:${messageVisibleSignature(message, activeApprovalIds)}`;
    if (seenSnapshots.has(snapshotKey)) continue;

    seenSnapshots.add(snapshotKey);
    visible.push({
      key: `${messageId}:${index}`,
      message
    });
  }

  return visible.reverse();
}

function messageVisibleSignature(message: UIMessage, activeApprovalIds: ReadonlySet<string>) {
  return compactMessageParts(message.parts)
    .filter(({ part }) => partHasVisibleContent(part, activeApprovalIds))
    .map(({ part, index }) => {
      if (isTextUIPart(part)) return `text:${part.text}`;
      if (isToolUIPart(part)) {
        const id = getToolCallId(part) ?? getToolApproval(part)?.id ?? String(index);
        return `tool:${getToolName(part)}:${id}:${toolPartStateKey(part)}`;
      }
      return String(index);
    })
    .join("|");
}

function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 140;
}

function formatChatErrorMessage(error: Error | undefined) {
  if (!error?.message) return null;
  if (error.message.startsWith("Tool result is missing for tool call")) {
    return "A previous tool call is incomplete in the saved history. It has been isolated; send the request again if needed.";
  }
  if (
    error.message.includes("not found for approval request") ||
    error.message.includes("Tool approval response references unknown approvalId")
  ) {
    return "A stale tool approval was left in saved history. It has been isolated; send a new request to run the operation again.";
  }
  if (error.message.includes("for missing text part") || error.message.includes("for missing reasoning part")) {
    return "The stream sent an out-of-order protocol chunk. Dismiss this notice and send the next message when ready.";
  }
  return error.message;
}

function isProtocolRecoveryError(error: Error | undefined) {
  const message = error?.message ?? "";
  return (
    message.startsWith("Tool result is missing for tool call") ||
    message.includes("not found for approval request") ||
    message.includes("Tool approval response references unknown approvalId") ||
    message.includes("for missing text part") ||
    message.includes("for missing reasoning part") ||
    message.includes("Cannot read properties of undefined (reading 'state')")
  );
}

function hasUnsettledToolInput(messages: UIMessage[]) {
  const turn = latestRenderableAssistantTurn(messages);
  if (!turn) return false;
  return turn.message.parts.some((part) => {
    if (!isToolUIPart(part)) return false;
    const state = toolPartStateKey(part);
    return state === "input-streaming" || state === "input-available";
  });
}

function toolContinuationCandidate(messages: UIMessage[]): ToolContinuationCandidate | null {
  const turn = latestRenderableAssistantTurn(messages);
  if (!turn) return null;

  const settledToolKeys: string[] = [];
  const toolCallIds = new Set<string>();
  const approvalIds = new Set<string>();
  let lastToolPartIndex = -1;

  for (let partIndex = 0; partIndex < turn.message.parts.length; partIndex += 1) {
    const part = turn.message.parts[partIndex];
    if (!part || !isToolUIPart(part)) continue;

    const state = toolPartStateKey(part);
    if (state === "input-streaming" || state === "input-available" || state === "waiting-approval") return null;
    if (!isSettledToolState(state)) continue;

    lastToolPartIndex = partIndex;
    const toolName = getToolName(part);
    const toolCallId = getToolCallId(part);
    const approval = getToolApproval(part);
    const partId = toolCallId ?? approval?.id ?? String(partIndex);
    if (toolCallId) toolCallIds.add(toolCallId);
    if (approval?.id) approvalIds.add(approval.id);
    settledToolKeys.push(toolName + ":" + partId + ":" + state);
  }

  if (settledToolKeys.length === 0 || lastToolPartIndex < 0) return null;

  const hasAssistantTextAfterLastTool = turn.message.parts.slice(lastToolPartIndex + 1).some((part) => {
    return isTextUIPart(part) && part.text.trim().length > 0;
  });
  if (hasAssistantTextAfterLastTool) return null;

  const messageId = turn.message.id || "assistant:" + turn.messageIndex;
  return {
    signature: messageId + ":" + settledToolKeys.join("|"),
    toolCallIds,
    approvalIds
  };
}

function isSettledToolState(state: string) {
  return state === "approval-responded" || state === "approved" || state === "output-available" || state === "output-error";
}

function toolPartStateKey(part: UIMessage["parts"][number]) {
  return rawToolPartState(part) || String(getToolPartState(part) ?? "");
}

function rawToolPartState(part: UIMessage["parts"][number]) {
  return typeof (part as { state?: unknown }).state === "string"
    ? String((part as { state: string }).state)
    : "";
}

function indexActivePendingApprovals(messages: UIMessage[], activeApprovalIds: ReadonlySet<string>) {
  const index = new Map<string, string>();
  const turn = latestRenderableAssistantTurn(messages);
  if (!turn) return index;

  for (const part of turn.message.parts) {
    if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

    const approval = getToolApproval(part);
    const toolCallId = getToolCallId(part);
    if (!approval?.id || !activeApprovalIds.has(approval.id)) continue;
    if (approval?.id && toolCallId) index.set(approval.id, toolCallId);
  }

  return index;
}

function indexPendingApprovalIdsAfter(messages: UIMessage[], startIndex: number) {
  const index = new Set<string>();
  for (let messageIndex = startIndex; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") continue;

    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

      const approval = getToolApproval(part);
      if (approval?.id) index.add(approval.id);
    }
  }

  return index;
}

function stringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
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

function formatSubAgentMode(mode: SubAgentMode) {
  if (mode === "agents-sdk") return "Chat/state";
  if (mode === "executor") return "Executor";
  return "Hybrid";
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatExecutionPlane(plane?: RuntimeExecutionPlane) {
  if (!plane) return "Checking";
  if (plane.enabled || plane.configured) return plane.status ? titleCase(plane.status) : "Enabled";
  if (plane.default) return "Default pending";
  return "Not configured";
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function partKey(part: UIMessage["parts"][number], index: number) {
  if (isToolUIPart(part)) return (getToolCallId(part) ?? getToolApproval(part)?.id ?? "tool") + ":" + index;
  return String(index);
}

function mcpServerSnapshotsEqual(
  left: Record<string, McpServerState>,
  right: Record<string, McpServerState>
) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    const rightKey = rightKeys[index];
    if (!key || key !== rightKey) return false;
    const leftServer = left[key];
    const rightServer = right[key];
    if (!leftServer || !rightServer) return false;
    if (leftServer.connectionState !== rightServer.connectionState) return false;
    if (leftServer.state !== rightServer.state) return false;
    if ((leftServer.tools?.length ?? 0) !== (rightServer.tools?.length ?? 0)) return false;
  }

  return true;
}

function normalizeMcpServers(value: unknown): Record<string, McpServerState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, McpServerState>;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Request failed.");
  }
  return data as T;
}

createRoot(document.getElementById("root")!).render(<App />);
