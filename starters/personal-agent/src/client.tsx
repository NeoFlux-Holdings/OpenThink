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

const PatchDiffRenderer = lazy(async () => {
  const { PatchDiff } = await import("@pierre/diffs/react");
  return {
    default: function PatchDiffRenderer({ patch }: { patch: string }) {
      return (
        <PatchDiff
          disableWorkerPool
          options={{
            diffIndicators: "bars",
            diffStyle: "unified",
            lineDiffType: "word",
            overflow: "wrap",
            theme: "pierre-light",
            themeType: "light"
          }}
          patch={patch}
        />
      );
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

const runModes = [
  { id: "auto", label: "Auto" },
  { id: "plan-first", label: "Plan first" },
  { id: "train", label: "Train" }
] as const;

type RunMode = (typeof runModes)[number]["id"];

type SocketDiagnostic = {
  state: "closed" | "error" | "reconnecting";
  detail: string;
  at: string;
};

type TrainStep = {
  id: string;
  text: string;
  approved: boolean;
};

type TrainPlanState = {
  objective: string;
  steps: TrainStep[];
  draftVisible: boolean;
  granular: boolean;
};

function App() {
  return (
    <main className="app">
      <Chat />
    </main>
  );
}

function Chat() {
  const [runMode, setRunMode] = useState<RunMode>("auto");
  const [trainPlan, setTrainPlan] = useState<TrainPlanState>(() => defaultTrainPlanState());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerState>>({});
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserDiagnosticsResponse | null>(null);
  const [browserDiagnosticsBusy, setBrowserDiagnosticsBusy] = useState(false);
  const [capabilitySummary, setCapabilitySummary] = useState<CapabilitySummary | null>(null);
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<Set<string>>(() => readAlwaysAllowedTools());
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState("");
  const [subAgentMessages, setSubAgentMessages] = useState<SubAgentMessage[]>([]);
  const [subAgentAction, setSubAgentAction] = useState<SubAgentAction | null>(null);
  const [subAgentError, setSubAgentError] = useState<string | null>(null);
  const [subAgentDraft, setSubAgentDraft] = useState<SubAgentDraft>(defaultSubAgentDraft);
  const [learningActionId, setLearningActionId] = useState<string | null>(null);
  const [sdkCopied, setSdkCopied] = useState(false);
  const [sessionApprovalIds, setSessionApprovalIds] = useState<Set<string>>(() => new Set());
  const [pendingUserMessage, setPendingUserMessage] = useState<PendingUserMessage | null>(null);
  const [pendingAssistantMessage, setPendingAssistantMessage] = useState<PendingAssistantMessage | null>(null);
  const [emptyResponseMessage, setEmptyResponseMessage] = useState<string | null>(null);
  const [socketGeneration, setSocketGeneration] = useState(0);
  const [socketDiagnostic, setSocketDiagnostic] = useState<SocketDiagnostic | null>(null);
  const autoApprovedApprovalIdsRef = useRef<Set<string>>(new Set());
  const toolContinuationAttemptSignaturesRef = useRef<Set<string>>(new Set());
  const sessionTurnStartIndexRef = useRef<number | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);
  const socketRecoveryAttemptsRef = useRef(0);

  const handleMcpUpdate = useCallback((servers: unknown) => {
    setMcpServers((previous) => {
      const next = normalizeMcpServers(servers);
      return mcpServerSnapshotsEqual(previous, next) ? previous : next;
    });
  }, []);

  const agent = useAgent({
    agent: "PersonalChatAgent",
    name: "default",
    query: { ot_socket: String(socketGeneration) },
    onMcpUpdate: handleMcpUpdate,
    onOpen: () => {
      socketRecoveryAttemptsRef.current = 0;
      setSocketDiagnostic(null);
    },
    onClose: (event) => {
      setSocketDiagnostic({
        at: new Date().toISOString(),
        detail: formatSocketClose(event),
        state: "closed"
      });
    },
    onError: () => {
      setSocketDiagnostic({
        at: new Date().toISOString(),
        detail: "WebSocket error while connecting to the agent.",
        state: "error"
      });
    }
  });
  const {
    messages,
    setMessages,
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
    autoContinueAfterToolResult: true,
    resume: true,
    cancelOnClientAbort: false,
    getInitialMessages: getInitialAgentMessages,
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
  const visibleEmptyResponseMessage = busy ? null : emptyResponseMessage;
  const chatErrorMessage = approvalErrorMessage ?? visibleEmptyResponseMessage;
  const retryIsSafe = !isProtocolRecoveryError(error);
  const canRetry =
    connected &&
    !busy &&
    retryIsSafe &&
    pendingApprovalCount === 0 &&
    messages.some((message) => message.role === "user");
  const selectedSubAgent = subAgents.find((subAgent) => subAgent.id === selectedSubAgentId) ?? subAgents[0] ?? null;
  const activeSubAgentCount = subAgents.filter((subAgent) => subAgent.status !== "archived").length;
  const searchResults = useMemo(
    () => searchPaletteResults(searchQuery, messages, activeApprovalIds, capabilitySummary, subAgents),
    [activeApprovalIds, capabilitySummary, messages, searchQuery, subAgents]
  );
  const subAgentBusy = subAgentAction !== null;
  const executionState = runtimeHealth?.cloudAgentInstance?.execution;
  const codeModeState = runtimeHealth?.cloudAgentInstance?.codeMode;
  const workspaceState = runtimeHealth?.cloudAgentInstance?.workspace;
  const showAssistantPlaceholder = pendingAssistantMessage !== null && pendingApprovalCount === 0;
  const assistantPlaceholderText = busy ? "Working..." : "No assistant output was received.";

  const forceReconnect = useCallback(() => {
    socketRecoveryAttemptsRef.current = 0;
    setSocketDiagnostic({
      at: new Date().toISOString(),
      detail: "Opening a fresh agent socket.",
      state: "reconnecting"
    });
    setSocketGeneration((generation) => generation + 1);
    agent.reconnect();
  }, [agent]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !stickToBottomRef.current) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, status, isStreaming, isServerStreaming]);

  useEffect(() => {
    if (agent.readyState !== WebSocket.CLOSING) return;
    if (socketRecoveryAttemptsRef.current >= 3) return;

    const timeout = window.setTimeout(() => {
      if (agent.readyState !== WebSocket.CLOSING) return;
      socketRecoveryAttemptsRef.current += 1;
      setSocketDiagnostic({
        at: new Date().toISOString(),
        detail: "Agent socket was stuck closing; opening a fresh socket.",
        state: "reconnecting"
      });
      setSocketGeneration((generation) => generation + 1);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [agent.readyState, socketGeneration]);

  useEffect(() => {
    void loadSubAgents();
    void loadRuntimeHealth();
    void loadBrowserDiagnostics();
    void loadCapabilitySummary();
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
      setEmptyResponseMessage(null);
    }
  }, [messages, pendingAssistantMessage, sessionApprovalIds]);

  useEffect(() => {
    if (!emptyResponseMessage) return;
    const latestUserMessage = latestUserTextMessageAfter(messages, 0);
    if (!latestUserMessage) return;
    if (messagesContainRenderableAssistantAfter(messages, latestUserMessage.index, sessionApprovalIds)) {
      setEmptyResponseMessage(null);
    }
  }, [emptyResponseMessage, messages, sessionApprovalIds]);

  useEffect(() => {
    if (!error) return;
    setPendingUserMessage(null);
    setPendingAssistantMessage(null);
  }, [error]);

  useEffect(() => {
    function onWindowKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  useEffect(() => {
    if (!pendingAssistantMessage || busy || !connected || error || pendingApprovalCount > 0) return;
    if (messagesContainRenderableAssistantAfter(messages, pendingAssistantMessage.startIndex, sessionApprovalIds)) return;

    const startIndex = pendingAssistantMessage.startIndex;
    const refreshTimer = window.setTimeout(() => {
      void getAgentMessages()
        .then((refreshedMessages) => {
          if (messagesContainRenderableAssistantAfter(refreshedMessages, startIndex, sessionApprovalIds)) {
            setMessages(refreshedMessages);
            setPendingAssistantMessage(null);
            setEmptyResponseMessage(null);
            return;
          }

          setPendingAssistantMessage(null);
          setEmptyResponseMessage("No assistant output was received. Retry the last message when ready.");
        })
        .catch(() => {
          setPendingAssistantMessage(null);
          setEmptyResponseMessage("No assistant output was received. Retry the last message when ready.");
        });
    }, 800);

    return () => window.clearTimeout(refreshTimer);
  }, [busy, connected, error, messages, pendingAssistantMessage, pendingApprovalCount, sessionApprovalIds, setMessages]);

  useEffect(() => {
    if (!connected) return;
    const recoveredContinuation = toolContinuationCandidate(messages);
    if (!recoveredContinuation) return;
    if (!pendingToolContinuationMarkerMatches(recoveredContinuation, readPendingToolContinuationMarker())) return;
    if (toolContinuationAttemptSignaturesRef.current.has(recoveredContinuation.signature)) return;
    toolContinuationAttemptSignaturesRef.current.add(recoveredContinuation.signature);
    clearPendingToolContinuationMarker();
  }, [connected, messages]);

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
    const trainSubmission = runMode === "train" ? buildTrainModeSubmission(text, trainPlan) : null;
    if (trainSubmission && !trainSubmission.ready) {
      setTrainPlan(draftTrainPlan(trainSubmission.objective || text, trainPlan));
      composerInputRef.current?.focus();
      return;
    }
    const outboundText = trainSubmission?.text ?? applyRunModeToMessage(text, runMode);
    clearError();
    setEmptyResponseMessage(null);
    clearPendingToolContinuationMarker();
    sessionTurnStartIndexRef.current = messages.length;
    setSessionApprovalIds(new Set());
    setPendingUserMessage({
      text: outboundText,
      startIndex: messages.length
    });
    setPendingAssistantMessage({
      startIndex: messages.length
    });
    stickToBottomRef.current = true;
    sendMessage({ text: outboundText });
    if (input) input.value = "";
    if (runMode === "train") setTrainPlan(defaultTrainPlanState());
  }

  function draftTrainPlanFromComposer() {
    const objective = composerInputRef.current?.value.trim() || trainPlan.objective;
    if (!objective.trim()) {
      composerInputRef.current?.focus();
      return;
    }
    setTrainPlan(draftTrainPlan(objective, trainPlan));
  }

  function onClearHistory() {
    if (messages.length === 0) return;
    if (window.confirm("Clear this agent's persisted conversation history?")) {
      clearPendingToolContinuationMarker();
      sessionTurnStartIndexRef.current = null;
      setSessionApprovalIds(new Set());
      setPendingUserMessage(null);
      setPendingAssistantMessage(null);
      setEmptyResponseMessage(null);
      clearHistory();
    }
  }

  function onRetry() {
    if (!canRetry) return;
    clearError();
    setEmptyResponseMessage(null);
    const retryTarget = latestUserTextMessageAfter(messages, 0);
    if (retryTarget) {
      setPendingAssistantMessage({ startIndex: retryTarget.index });
      stickToBottomRef.current = true;
      void Promise.resolve(sendMessage({ text: retryTarget.text, messageId: retryTarget.id })).catch((retryError: unknown) => {
        console.error("[useAgentChat] Retry failed", retryError);
        setPendingAssistantMessage(null);
        setEmptyResponseMessage("Retry failed. Send the request again if needed.");
      });
      return;
    }
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

  async function loadBrowserDiagnostics() {
    try {
      const data = await fetchBrowserDiagnostics();
      setBrowserDiagnostics(data);
    } catch (loadError) {
      setBrowserDiagnostics({
        ok: false,
        status: "unavailable",
        mode: "read-only",
        summary: loadError instanceof Error ? loadError.message : "Could not load Browser Run diagnostics.",
        stages: []
      });
    }
  }

  async function runBrowserDiagnostics() {
    setBrowserDiagnosticsBusy(true);
    try {
      const data = await fetchBrowserDiagnostics({
        method: "POST",
        body: JSON.stringify({ live: true })
      });
      setBrowserDiagnostics(data);
    } catch (runError) {
      setBrowserDiagnostics({
        ok: false,
        status: "live-check-failed",
        mode: "live",
        summary: runError instanceof Error ? runError.message : "Browser Run live check failed.",
        stages: []
      });
    } finally {
      setBrowserDiagnosticsBusy(false);
    }
  }

  async function loadCapabilitySummary() {
    const [skills, learning, artifacts, contributions, executor, mcp, mcpObservability] = await Promise.all([
      optionalJsonFetch<SkillListResponse>("/skills"),
      optionalJsonFetch<LearningResponse>("/learning"),
      optionalJsonFetch<ArtifactListResponse>("/artifacts"),
      optionalJsonFetch<ContributionStatusResponse>("/contributions"),
      optionalJsonFetch<ExecutorResponse>("/executor"),
      optionalJsonFetch<McpServerCatalogResponse>("/mcp/servers"),
      optionalJsonFetch<McpObservabilityResponse>("/mcp/observability")
    ]);
    setCapabilitySummary({ skills, learning, artifacts, contributions, executor, mcp, mcpObservability });
  }

  async function curateLearningSuggestion(id: string, status: LearningSuggestionStatus, summary?: string) {
    setLearningActionId(id);
    try {
      await jsonFetch("/learning/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify(summary === undefined ? { status } : { status, summary })
      });
      await loadCapabilitySummary();
    } finally {
      setLearningActionId(null);
    }
  }

  async function editLearningSuggestion(suggestion: LearningSuggestion) {
    const nextSummary = window.prompt("Edit learning suggestion", suggestion.summary);
    if (nextSummary === null) return;
    await curateLearningSuggestion(suggestion.id, "pending", nextSummary);
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
        <PersonaSidebar
          activeSubAgentCount={activeSubAgentCount}
          focusComposer={() => composerInputRef.current?.focus()}
          openSearch={() => setSearchOpen(true)}
          pendingApprovalCount={pendingApprovalCount}
          summary={capabilitySummary}
        />

        <section className="chat-panel" aria-busy={busy} aria-label="Chat">
          <div className="panel-header">
            <h1>Conversation</h1>
            <p>Streaming, message persistence, client tools, and approvals are handled by Cloudflare Agents SDK.</p>
          </div>

          <div className="message-list" aria-live="polite" id="chat-feed" onScroll={onMessageListScroll} ref={messageListRef} role="log">
            {visibleMessages.length === 0 ? (
              <div className="empty-state">
                Use /goal to set an active objective, or ask for a plan, a Cloudflare operation, a memory lookup, or your browser timezone.
              </div>
            ) : (
              visibleMessages.map(({ key, message }, index) => (
                <Message
                  activeApprovalIds={activeApprovalIds}
                  approveToolAlways={approveToolAlways}
                  key={key + ":" + String(index)}
                  message={message}
                  respondToToolApproval={respondToToolApproval}
                />
              ))
            )}
            {pendingUserMessage ? <PendingMessage role="user" text={pendingUserMessage.text} /> : null}
            {showAssistantPlaceholder ? <PendingMessage role="assistant" text={assistantPlaceholderText} /> : null}
            {chatErrorMessage ? (
              <div className="error" role="alert">
                <span>{chatErrorMessage}</span>
                <div className="button-row">
                  <button
                    className="button button-compact"
                    onClick={() => {
                      clearError();
                      setEmptyResponseMessage(null);
                    }}
                    type="button"
                  >
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
            <div className="composer-mode" aria-label="Run mode" role="radiogroup">
              {runModes.map((mode) => (
                <button
                  aria-checked={runMode === mode.id}
                  className="mode-chip"
                  data-active={runMode === mode.id ? "true" : "false"}
                  key={mode.id}
                  onClick={() => setRunMode(mode.id)}
                  role="radio"
                  type="button"
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {runMode === "train" ? (
              <TrainPlanPanel
                connected={connected}
                onAddStep={() => setTrainPlan((current) => addTrainStep(current))}
                onApproveAll={() => setTrainPlan((current) => approveAllTrainSteps(current))}
                onClear={() => setTrainPlan(defaultTrainPlanState())}
                onDraft={draftTrainPlanFromComposer}
                onGranularChange={(granular) => setTrainPlan((current) => ({ ...current, granular }))}
                onMoveStep={(id, direction) => setTrainPlan((current) => moveTrainStep(current, id, direction))}
                onObjectiveChange={(objective) => setTrainPlan((current) => ({ ...current, objective, draftVisible: true }))}
                onRemoveStep={(id) => setTrainPlan((current) => removeTrainStep(current, id))}
                onStepApprovalChange={(id, approved) => setTrainPlan((current) => updateTrainStep(current, id, { approved }))}
                onStepTextChange={(id, text) => setTrainPlan((current) => updateTrainStep(current, id, { text }))}
                plan={trainPlan}
              />
            ) : null}
            <textarea
              aria-label="Message"
              autoComplete="off"
              disabled={!connected}
              name="message"
              onKeyDown={onComposerKeyDown}
              placeholder={connected ? "Ask, or start with /goal to set an active objective..." : "Reconnect to continue..."}
              ref={composerInputRef}
              rows={1}
            />
            <button className="button button-primary" disabled={!connected || busy} type="submit">
              {busy ? "Working" : "Send"}
            </button>
          </form>
        </section>

        <aside className="side-panel" aria-label="Artifact canvas and runtime details">
          <div className="panel-header">
            <h2>Canvas</h2>
            <p>Artifacts, workspace state, and runtime controls for this deployed agent.</p>
          </div>
          <div className="side-body" id="runtime">
            <ArtifactStage summary={capabilitySummary} />
            <Metric label="Transport" value="useAgent WebSocket" />
            <Metric label="Chat lifecycle" value="useAgentChat" />
            <Metric label="Socket detail" value={socketDiagnostic?.detail ?? connectionState} />
            <Metric label="Model" value={clientConfig.defaultModel} />
            <Metric label="MCP policy" value={formatToolApprovalPolicy(clientConfig.toolApprovalPolicy)} />
            <Metric label="Code Mode" value={formatCodeMode(codeModeState)} />
            <Metric label="History" value="SQLite persisted" />
            <Metric label="MCP servers" value={formatMcpStatus(mcpReadyCount, mcpServerValues.length)} />
            <Metric label="Approvals" value={pendingApprovalCount ? `${pendingApprovalCount} pending` : "None pending"} />
            <Metric label="Tool allowlist" value={formatToolAllowlist(alwaysAllowedToolCount)} />
            <Metric label="Executor MCP" value={formatExecutionPlane(executionState?.executor)} />
            <Metric label="Sandbox" value={formatExecutionPlane(executionState?.sandbox)} />
            <Metric label="Containers" value={formatExecutionPlane(executionState?.containers)} />
            <BrowserRunDiagnosticsPanel
              diagnostics={browserDiagnostics}
              loading={browserDiagnosticsBusy}
              onRefresh={loadBrowserDiagnostics}
              onRun={runBrowserDiagnostics}
            />
            <Metric label="Slash commands" value="/goal enabled" />
            <Metric label="Workspace" value={formatWorkspaceState(workspaceState)} />
            <Metric label="Sub-agents" value={subAgents.length ? `${activeSubAgentCount}/${subAgents.length} active` : "None"} />
            <div className="button-row">
              {busy ? (
                <button className="button" onClick={stop} type="button">
                  Stop
                </button>
              ) : null}
              <button
                className="button"
                disabled={connected}
                onClick={forceReconnect}
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
            <CapabilityCanvas
              learningActionId={learningActionId}
              onCurateLearning={curateLearningSuggestion}
              onEditLearning={editLearningSuggestion}
              onRefresh={loadCapabilitySummary}
              summary={capabilitySummary}
            />
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

      <CommandPalette
        onClose={() => setSearchOpen(false)}
        onQueryChange={setSearchQuery}
        open={searchOpen}
        query={searchQuery}
        results={searchResults}
      />
    </>
  );
}

function TrainPlanPanel({
  connected,
  onAddStep,
  onApproveAll,
  onClear,
  onDraft,
  onGranularChange,
  onMoveStep,
  onObjectiveChange,
  onRemoveStep,
  onStepApprovalChange,
  onStepTextChange,
  plan
}: {
  connected: boolean;
  onAddStep: () => void;
  onApproveAll: () => void;
  onClear: () => void;
  onDraft: () => void;
  onGranularChange: (granular: boolean) => void;
  onMoveStep: (id: string, direction: -1 | 1) => void;
  onObjectiveChange: (objective: string) => void;
  onRemoveStep: (id: string) => void;
  onStepApprovalChange: (id: string, approved: boolean) => void;
  onStepTextChange: (id: string, text: string) => void;
  plan: TrainPlanState;
}) {
  const approvedCount = plan.steps.filter((step) => step.approved).length;
  const ready = trainPlanReadyToRun(plan);

  return (
    <section className="train-panel" aria-label="Editable train plan" data-ready={ready ? "true" : "false"}>
      <div className="train-panel-heading">
        <div>
          <strong>Train plan</strong>
          <p>
            Draft, edit, and approve a repeatable plan before the agent acts. Send runs only after the plan is approved.
          </p>
        </div>
        <div className="button-row">
          <button className="button button-compact" disabled={!connected} onClick={onDraft} type="button">
            Draft plan
          </button>
          {plan.draftVisible ? (
            <button className="button button-compact" onClick={onClear} type="button">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {plan.draftVisible ? (
        <>
          <label className="train-objective">
            <span>Objective</span>
            <input
              onChange={(event) => onObjectiveChange(event.currentTarget.value)}
              placeholder="What should this train-mode run accomplish?"
              type="text"
              value={plan.objective}
            />
          </label>

          <div className="train-options">
            <label>
              <input
                checked={plan.granular}
                onChange={(event) => onGranularChange(event.currentTarget.checked)}
                type="checkbox"
              />
              Step-by-step approval
            </label>
            <span>
              {approvedCount}/{plan.steps.length} approved
            </span>
          </div>

          <ol className="train-step-list">
            {plan.steps.map((step, index) => (
              <li className="train-step" data-approved={step.approved ? "true" : "false"} key={step.id}>
                <label className="train-step-check">
                  <input
                    checked={step.approved}
                    onChange={(event) => onStepApprovalChange(step.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{step.approved ? "Approved" : "Review"}</span>
                </label>
                <textarea
                  aria-label={"Train step " + String(index + 1)}
                  onChange={(event) => onStepTextChange(step.id, event.currentTarget.value)}
                  rows={2}
                  value={step.text}
                />
                <div className="train-step-actions">
                  <button className="button button-compact" disabled={index === 0} onClick={() => onMoveStep(step.id, -1)} type="button">
                    Up
                  </button>
                  <button
                    className="button button-compact"
                    disabled={index === plan.steps.length - 1}
                    onClick={() => onMoveStep(step.id, 1)}
                    type="button"
                  >
                    Down
                  </button>
                  <button className="button button-compact" onClick={() => onRemoveStep(step.id)} type="button">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <div className="train-footer">
            <p>{ready ? "Ready to run. Press Send to execute the approved train plan." : trainPlanReadinessCopy(plan)}</p>
            <div className="button-row">
              <button className="button button-compact" onClick={onAddStep} type="button">
                Add step
              </button>
              <button className="button button-compact" disabled={plan.steps.length === 0} onClick={onApproveAll} type="button">
                Approve all
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="train-empty">
          Type the objective, then press Send or Draft plan. The editable plan appears here before any tools run.
        </p>
      )}
    </section>
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
      {blocks.map((block, index) =>
        block.kind === "tool-group" ? (
          <ToolPartGroup
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={block.key + ":" + String(index)}
            parts={block.parts}
            respondToToolApproval={respondToToolApproval}
          />
        ) : (
          <MessagePart
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={block.key + ":" + String(index)}
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
  const renderDetails = summary.defaultOpen || summary.state !== "streaming";

  return (
    <details className="tool-group" data-state={summary.state} open={summary.defaultOpen ? true : undefined}>
      <summary>
        <span className="tool-group-title">
          <strong>{summary.title}</strong>
          <small>{summary.detail}</small>
        </span>
        <span className="tool-group-meta">
          <span className="pill" data-state={summary.state}>{toolStateLabel(summary.state)}</span>
          <span className="tool-group-toggle">Details</span>
        </span>
      </summary>
      <div className="tool-group-details">
        {renderDetails ? parts.map(({ part, index }, partIndex) => (
          <MessagePart
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={partKey(part, index) + ":" + String(partIndex)}
            part={part}
            respondToToolApproval={respondToToolApproval}
          />
        )) : <p className="tool-note">Details are available when this tool call settles.</p>}
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
    const presentation = summarizeToolPart(part, activeApprovalIds);
    const hasRawPayload = showToolPayload && (Boolean(input) || Boolean(output));

    return (
      <div className="tool-part" data-state={displayState}>
        <div className="tool-heading">
          <div className="tool-summary-copy">
            <strong>{presentation.title}</strong>
            {presentation.description ? <p>{presentation.description}</p> : null}
            {presentation.outcome ? <p className="tool-outcome">{presentation.outcome}</p> : null}
          </div>
          <span className="pill" data-state={displayState}>{toolStateLabel(displayState)}</span>
        </div>
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
        {hasRawPayload ? (
          <details className="tool-raw-details">
            <summary>Raw details</summary>
            <div className="tool-raw-section">
              <span className="tool-output-label">Tool</span>
              <code className="tool-inline-code">{presentation.rawName}</code>
            </div>
            {input ? (
              <div className="tool-raw-section">
                <span className="tool-output-label">Input</span>
                <pre>{formatJson(input)}</pre>
              </div>
            ) : null}
            {output ? (
              <div className="tool-raw-section">
                <span className="tool-output-label">Output</span>
                <pre>{formatJson(output)}</pre>
              </div>
            ) : null}
          </details>
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

function CommandPalette({
  onClose,
  onQueryChange,
  open,
  query,
  results
}: {
  onClose: () => void;
  onQueryChange: (query: string) => void;
  open: boolean;
  query: string;
  results: SearchResult[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return (
    <div className="command-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Search workspace"
        aria-modal="true"
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="command-input-row">
          <input
            aria-label="Search threads, artifacts, skills, and memories"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search threads, artifacts, skills, memories..."
            ref={inputRef}
            value={query}
          />
          <button className="button button-compact" onClick={onClose} type="button">
            Esc
          </button>
        </div>
        <div className="command-tabs" aria-label="Search scopes">
          <span>Threads</span>
          <span>Artifacts</span>
          <span>Memories</span>
          <span>Agents</span>
        </div>
        <div className="command-results">
          {results.length > 0 ? (
            results.map((result, index) => (
              <a className="command-result" href={result.target} key={result.id + ":" + String(index)} onClick={onClose}>
                <span>{result.kind}</span>
                <strong>{result.title}</strong>
                <small>{result.detail}</small>
              </a>
            ))
          ) : (
            <p>No results yet. Try a message, artifact name, skill, or sub-agent.</p>
          )}
        </div>
        <footer className="command-footer">Ctrl K opens search. Enter opens the selected result in its workspace surface.</footer>
      </section>
    </div>
  );
}

function PersonaSidebar({
  activeSubAgentCount,
  focusComposer,
  openSearch,
  pendingApprovalCount,
  summary
}: {
  activeSubAgentCount: number;
  focusComposer: () => void;
  openSearch: () => void;
  pendingApprovalCount: number;
  summary: CapabilitySummary | null;
}) {
  const artifactCount = summary?.artifacts?.artifacts?.length ?? 0;
  const skillCount = summary?.skills?.skills?.length ?? 0;
  const learningCount =
    Number(summary?.learning?.memories?.pending ?? 0) +
    Number(summary?.learning?.skills?.pending ?? 0);
  const recentThreads = ["Current conversation", "Workspace brief", "Sub-agent reports"];

  return (
    <nav className="persona-sidebar" aria-label="Workspace navigation">
      <button className="button button-primary sidebar-primary" onClick={focusComposer} type="button">
        New Task
      </button>
      <button className="sidebar-link" onClick={openSearch} type="button">
        Search <span>Ctrl K</span>
      </button>
      <a href="#artifact-canvas">
        Library <span>{artifactCount}</span>
      </a>
      <a href="#learning">
        Learning <span>{learningCount}</span>
      </a>
      <a href="#skills">
        Skills <span>{skillCount}</span>
      </a>
      <div className="sidebar-divider" />
      <small>Recent</small>
      {recentThreads.map((thread) => (
        <a href="#chat-feed" key={thread}>{thread}</a>
      ))}
      <div className="sidebar-divider" />
      <a href="#subagents">
        Sub-agents <span>{activeSubAgentCount}</span>
      </a>
      <a href="#runtime">
        Approvals <span>{pendingApprovalCount}</span>
      </a>
    </nav>
  );
}

function ArtifactStage({ summary }: { summary: CapabilitySummary | null }) {
  const artifacts = summary?.artifacts?.artifacts ?? [];
  const [mode, setMode] = useState<ArtifactCanvasMode>("single");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [detail, setDetail] = useState<ArtifactDetailResponse | null>(null);
  const [poppedArtifact, setPoppedArtifact] = useState(false);
  const featured = artifacts.find((artifact) => artifact.key === selectedKey) ?? artifacts[0];
  const learning = summary?.learning;
  const skills = summary?.skills?.skills ?? [];

  useEffect(() => {
    if (!artifacts.length) {
      setSelectedKey("");
      setSelectedVersion("");
      setDetail(null);
      return;
    }
    if (!featured) {
      setSelectedKey(artifacts[0]?.key ?? "");
    }
  }, [artifacts, featured]);

  useEffect(() => {
    if (!featured?.key) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ key: featured.key, versions: "1" });
    if (selectedVersion) params.set("version", selectedVersion);
    optionalJsonFetch<ArtifactDetailResponse>("/artifacts?" + params.toString(), { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setDetail(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetail(null);
      });
    return () => controller.abort();
  }, [featured?.key, selectedVersion]);

  const versions = detail?.versions ?? [];
  const artifactText = detail?.text ?? "";

  return (
    <section className="artifact-stage" id="artifact-canvas" aria-label="Artifact canvas">
      <div className="artifact-stage-header">
        <div>
          <strong>{featured?.title || featured?.key || "No artifact selected"}</strong>
          <small>{featured?.type || "Workspace canvas"}{featured?.versions ? " / v" + String(featured.versions) : ""}</small>
        </div>
        <div className="canvas-mode-toggle" aria-label="Canvas mode">
          {(["single", "grid", "stack"] as const).map((nextMode) => (
            <button
              aria-pressed={mode === nextMode}
              key={nextMode}
              onClick={() => setMode(nextMode)}
              type="button"
            >
              {titleCase(nextMode)}
            </button>
          ))}
        </div>
      </div>
      {versions.length > 1 ? (
        <label className="artifact-version-picker">
          <span>Version</span>
          <select onChange={(event) => setSelectedVersion(event.target.value)} value={selectedVersion}>
            {versions.map((version) => (
              <option key={version.versionKey} value={version.current ? "" : version.versionKey}>
                {version.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className={"artifact-preview artifact-preview-" + mode}>
        {featured ? (
          mode === "grid" ? (
            artifacts.slice(0, 4).map((artifact, index) => (
              <button className="artifact-grid-card" key={artifact.key + ":" + String(index)} onClick={() => setSelectedKey(artifact.key)} type="button">
                <span>{artifact.type || "artifact"}</span>
                <strong>{artifact.title || artifact.key}</strong>
                <small>{artifact.uploaded ? formatRelativeTime(artifact.uploaded) : "Ready"}</small>
              </button>
            ))
          ) : mode === "stack" ? (
            <div className="artifact-stack">
              {artifacts.slice(0, 8).map((artifact, index) => (
                <button
                  className="artifact-stack-card"
                  key={artifact.key + ":" + String(index)}
                  onClick={() => setSelectedKey(artifact.key)}
                  style={{ transform: "translateY(" + String(index * 6) + "px)" }}
                  type="button"
                >
                  <span>{artifact.type || "artifact"}</span>
                  <strong>{artifact.title || artifact.key}</strong>
                </button>
              ))}
            </div>
          ) : (
            <ArtifactInlinePreview artifact={featured} text={artifactText} />
          )
        ) : (
          <>
            <span>Workspace</span>
            <strong>Artifacts will appear here</strong>
            <small>Documents, code, tables, images, and app previews</small>
          </>
        )}
      </div>
      {featured ? (
        <button className="button button-compact artifact-popout-trigger" onClick={() => setPoppedArtifact(true)} type="button">
          Pop out artifact
        </button>
      ) : null}
      <div className="artifact-rail" aria-label="Artifact thumbnails">
        {artifacts.slice(0, 6).map((artifact, index) => (
          <button
            aria-pressed={featured?.key === artifact.key}
            className="artifact-thumb"
            key={artifact.key + ":" + String(index)}
            onClick={() => {
              setSelectedKey(artifact.key);
              setSelectedVersion("");
            }}
            type="button"
          >
            {artifact.type || "file"}
          </button>
        ))}
        {artifacts.length === 0 ? <span className="artifact-thumb">empty</span> : null}
      </div>
      <div className="canvas-quicklinks">
        <a href="#learning" id="learning">Train {learning ? formatLearningState(learning) : "ready"}</a>
        <a href="#skills" id="skills">Skills {skills.length}</a>
      </div>
      {poppedArtifact && featured ? (
        <div className="artifact-popout" role="dialog" aria-modal="true" aria-label="Artifact preview">
          <div className="artifact-popout-window">
            <div className="artifact-popout-header">
              <div>
                <strong>{featured.title || featured.key}</strong>
                <small>{featured.type || "artifact"}</small>
              </div>
              <button className="button button-compact" onClick={() => setPoppedArtifact(false)} type="button">
                Close
              </button>
            </div>
            <ArtifactInlinePreview artifact={featured} text={artifactText} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ArtifactInlinePreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const type = artifact.type || "artifact";
  if (type === "browser-session") {
    return <BrowserSessionPreview artifact={artifact} session={parseBrowserSessionArtifact(text)} />;
  }
  if (type === "webpage" && text) {
    return <iframe className="artifact-web-preview" sandbox="" srcDoc={text} title={artifact.title || artifact.key} />;
  }
  if (type === "image") {
    return <ImageArtifactPreview artifact={artifact} text={text} />;
  }
  if (type === "slides") {
    return <SlidesArtifactPreview artifact={artifact} text={text} />;
  }
  if (type === "diff" || isDiffArtifactKey(artifact.key)) {
    return <DiffArtifactPreview artifact={artifact} text={text} />;
  }
  if (type === "table" && text) {
    const rows = parseDelimitedRows(text).slice(0, 12);
    if (rows.length > 0) {
      const [header = [], ...body] = rows;
      return (
        <div className="artifact-table-preview">
          <span>{type}</span>
          <strong>{artifact.title || artifact.key}</strong>
          <div className="artifact-table-scroll">
            <table>
              <thead>
                <tr>
                  {header.map((cell, index) => <th key={String(index)}>{cell || "Column " + String(index + 1)}</th>)}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={String(rowIndex)}>
                    {header.map((_cell, cellIndex) => <td key={String(cellIndex)}>{row[cellIndex] ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }
  return (
    <div className="artifact-text-preview">
      <span>{type}</span>
      <strong>{artifact.title || artifact.key}</strong>
      <small>{artifact.uploaded ? formatRelativeTime(artifact.uploaded) : "Ready"}</small>
      {text ? <pre>{text.slice(0, 2400)}</pre> : <p>Open or generate content to preview this artifact.</p>}
    </div>
  );
}

function DiffArtifactPreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const patch = text.trim();
  const stats = summarizePatch(patch);
  return (
    <div className="artifact-diff-preview">
      <div className="artifact-preview-heading">
        <span>diff</span>
        <strong>{artifact.title || artifact.key}</strong>
      </div>
      <div className="artifact-diff-stats">
        <span>{stats.files} files</span>
        <span>+{stats.additions}</span>
        <span>-{stats.deletions}</span>
      </div>
      {patch ? (
        <Suspense fallback={<pre>{patch.slice(0, 2400)}</pre>}>
          <PatchDiffRenderer patch={patch} />
        </Suspense>
      ) : (
        <p>No patch content is available for this artifact.</p>
      )}
    </div>
  );
}

function ImageArtifactPreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const source = imageSourceFromText(text);
  const title = artifact.title || artifact.key;
  return (
    <div className="artifact-image-preview">
      <div className="artifact-preview-heading">
        <span>image</span>
        <strong>{title}</strong>
      </div>
      {source ? (
        <>
          <div className="artifact-image-frame">
            <img alt={title} src={source} />
          </div>
          <div className="artifact-preview-actions">
            <a className="button button-compact" href={source} rel="noreferrer" target="_blank">Open</a>
            <a className="button button-compact" download={artifact.key.split("/").pop() || "image"} href={source}>Download</a>
          </div>
        </>
      ) : (
        <p>Image content is available, but it is not a URL, data URL, markdown image, or base64 image payload.</p>
      )}
    </div>
  );
}

function SlidesArtifactPreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const slides = parseSlidesArtifact(text);
  const [index, setIndex] = useState(0);
  const activeIndex = Math.min(index, Math.max(slides.length - 1, 0));
  const slide = slides[activeIndex];

  return (
    <div className="artifact-slides-preview">
      <div className="artifact-preview-heading">
        <span>slides</span>
        <strong>{artifact.title || artifact.key}</strong>
      </div>
      {slide ? (
        <>
          <div className="artifact-slide-frame">
            {slide.title ? <h3>{slide.title}</h3> : null}
            {slide.body ? <pre>{slide.body}</pre> : <p>No slide body.</p>}
          </div>
          <div className="artifact-slide-controls">
            <button className="button button-compact" disabled={activeIndex <= 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} type="button">Prev</button>
            <span>{activeIndex + 1} / {Math.max(slides.length, 1)}</span>
            <button className="button button-compact" disabled={activeIndex >= slides.length - 1} onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))} type="button">Next</button>
          </div>
          {slide.notes ? <p className="artifact-slide-notes">{slide.notes}</p> : null}
        </>
      ) : (
        <p>No slides found. Use JSON with a "slides" array or markdown slides separated by "---".</p>
      )}
    </div>
  );
}

type BrowserSessionArtifact = {
  mode?: string | null;
  url?: string | null;
  title?: string | null;
  status?: string | null;
  capturedAt?: string | null;
  createdAt?: string | null;
  sessionId?: string | null;
  screenshotDataUrl?: string | null;
  screenshotUrl?: string | null;
  html?: string | null;
  devtoolsFrontendUrl?: string | null;
  takeoverUrl?: string | null;
  webSocketDebuggerUrl?: string | null;
  target?: BrowserSessionTarget | null;
  targets?: BrowserSessionTarget[];
  events?: Array<{
    label?: string;
    status?: string;
    at?: string;
  }>;
};

type BrowserSessionTarget = {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  devtoolsFrontendUrl?: string;
  webSocketDebuggerUrl?: string;
};

function BrowserSessionPreview({
  artifact,
  session
}: {
  artifact: ArtifactListItem;
  session: BrowserSessionArtifact | null;
}) {
  const [streamFrame, setStreamFrame] = useState("");
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "streaming" | "failed" | "done">("idle");
  const title = session?.title || artifact.title || artifact.key;
  const primaryTarget = session?.target || session?.targets?.find((target) => target.devtoolsFrontendUrl || target.url) || null;
  const liveViewUrl = session?.devtoolsFrontendUrl || session?.takeoverUrl || primaryTarget?.devtoolsFrontendUrl || "";
  const webSocketUrl = session?.webSocketDebuggerUrl || primaryTarget?.webSocketDebuggerUrl || "";
  const targetUrl = session?.url || primaryTarget?.url || "about:blank";
  const screenshot = session?.screenshotDataUrl || session?.screenshotUrl || "";
  const frameStreamUrl = session?.mode === "live" && session?.sessionId && primaryTarget?.id
    ? `/browser/sessions/${encodeURIComponent(session.sessionId)}/targets/${encodeURIComponent(primaryTarget.id)}/frames?fps=4`
    : "";
  const frameStreamStatusUrl = session?.mode === "live" && session?.sessionId && primaryTarget?.id
    ? `/browser/sessions/${encodeURIComponent(session.sessionId)}/targets/${encodeURIComponent(primaryTarget.id)}/frames/status?fps=4`
    : "";
  const liveFrame = streamFrame || screenshot;
  const status = session?.status || "ready";
  const timestamp = session?.capturedAt || session?.createdAt || null;

  useEffect(() => {
    if (!frameStreamUrl || !frameStreamStatusUrl) {
      setStreamFrame("");
      setStreamStatus("idle");
      return undefined;
    }
    let cancelled = false;
    let events: EventSource | null = null;
    setStreamStatus("connecting");
    void fetch(frameStreamStatusUrl, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ hasWebSocketDebuggerUrl?: boolean }>)
      .then((data) => {
        if (cancelled) return;
        if (!data.hasWebSocketDebuggerUrl) {
          setStreamStatus("failed");
          return;
        }
        events = new EventSource(frameStreamUrl);
        events.addEventListener("status", (event) => {
          const eventData = parseJsonEventData(event);
          setStreamStatus(eventData?.status === "streaming" ? "streaming" : "connecting");
        });
        events.addEventListener("frame", (event) => {
          const eventData = parseJsonEventData(event);
          if (typeof eventData?.screenshotDataUrl === "string") {
            setStreamFrame(eventData.screenshotDataUrl);
            setStreamStatus("streaming");
          }
        });
        events.addEventListener("done", () => setStreamStatus("done"));
        events.addEventListener("error", () => setStreamStatus("failed"));
        events.onerror = () => setStreamStatus("failed");
      })
      .catch(() => {
        if (!cancelled) setStreamStatus("failed");
      });
    return () => {
      cancelled = true;
      events?.close();
    };
  }, [frameStreamUrl, frameStreamStatusUrl]);

  return (
    <div className="artifact-browser-session">
      <div className="browser-chrome">
        <span className="browser-dots" aria-hidden="true"><i /><i /><i /></span>
        <code>{targetUrl}</code>
        <span className="pill" data-state={status === "captured" ? "ready" : undefined}>{status}</span>
      </div>
      <div className="browser-viewport">
        {liveFrame ? (
          <img alt={title} src={liveFrame} />
        ) : liveViewUrl ? (
          <iframe
            allow="clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="no-referrer"
            src={liveViewUrl}
            title={title + " live view"}
          />
        ) : session?.html ? (
          <iframe sandbox="" srcDoc={session.html} title={title} />
        ) : (
          <div className="browser-empty-state">
            <strong>{title}</strong>
            <small>Browser session metadata is ready. Capture a snapshot to show the viewport.</small>
          </div>
        )}
      </div>
      <div className="browser-session-actions">
        {liveViewUrl ? <a className="button button-compact" href={liveViewUrl} rel="noreferrer" target="_blank">Live View</a> : null}
        {webSocketUrl ? <span title={webSocketUrl}>CDP session ready</span> : null}
        {frameStreamUrl ? <span className="browser-stream-status" data-state={streamStatus}>{streamStatus === "streaming" ? "Frames 4 fps" : streamStatus}</span> : null}
        <span>{timestamp ? "Updated " + formatRelativeTime(timestamp) : "Ready for Browser Run sessions"}</span>
      </div>
      {session?.sessionId || primaryTarget?.id ? (
        <div className="browser-session-meta">
          {session?.sessionId ? <span>Session <code>{session.sessionId}</code></span> : null}
          {primaryTarget?.id ? <span>Target <code>{primaryTarget.id}</code></span> : null}
        </div>
      ) : null}
      {session?.events?.length ? (
        <ul className="browser-session-events">
          {session.events.slice(0, 4).map((event, index) => (
            <li key={String(index)}>
              <span>{event.label || "Browser event"}</span>
              <small>{event.status || "recorded"}{event.at ? " / " + formatRelativeTime(event.at) : ""}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function parseJsonEventData(event: Event): Record<string, unknown> | null {
  const message = event as MessageEvent<string>;
  try {
    return JSON.parse(message.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseBrowserSessionArtifact(text: string): BrowserSessionArtifact | null {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text) as BrowserSessionArtifact;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

type SlidePreview = {
  title?: string;
  body?: string;
  notes?: string;
};

function isDiffArtifactKey(key: string): boolean {
  return /\.(diff|patch)$/i.test(key);
}

function summarizePatch(patch: string): { files: number; additions: number; deletions: number } {
  const lines = patch.split(/\r?\n/);
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) files.add(line);
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return {
    files: files.size || (patch.trim() ? 1 : 0),
    additions,
    deletions
  };
}

function imageSourceFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const markdownMatch = trimmed.match(/!\[[^\]]*]\(([^)]+)\)/);
  if (markdownMatch?.[1]) return markdownMatch[1].trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const candidate = parsed.src ?? parsed.url ?? parsed.dataUrl ?? parsed.image;
    if (typeof candidate === "string") return imageSourceFromText(candidate);
  } catch {
    // Fall through to raw base64 detection.
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s/g, "").length > 120) {
    return "data:image/png;base64," + trimmed.replace(/\s/g, "");
  }
  return "";
}

function parseSlidesArtifact(text: string): SlidePreview[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rawSlides = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { slides?: unknown }).slides)
        ? (parsed as { slides: unknown[] }).slides
        : [];
    if (rawSlides.length > 0) {
      return rawSlides.map((item, index) => {
        if (typeof item === "string") return { title: "Slide " + String(index + 1), body: item };
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const title = typeof record.title === "string" ? record.title : typeof record.heading === "string" ? record.heading : "Slide " + String(index + 1);
          const body = typeof record.body === "string"
            ? record.body
            : Array.isArray(record.bullets)
              ? record.bullets.map((bullet) => "- " + String(bullet)).join("\n")
              : typeof record.content === "string"
                ? record.content
                : "";
          const notes = typeof record.notes === "string" ? record.notes : "";
          return notes ? { title, body, notes } : { title, body };
        }
        return { title: "Slide " + String(index + 1), body: String(item) };
      });
    }
  } catch {
    // Markdown slides are parsed below.
  }

  return trimmed
    .split(/\n-{3,}\n/g)
    .map((chunk, index) => {
      const lines = chunk.trim().split(/\r?\n/);
      const first = lines[0]?.replace(/^#+\s*/, "").trim();
      const body = lines.slice(first ? 1 : 0).join("\n").trim();
      return { title: first || "Slide " + String(index + 1), body };
    })
    .filter((slide) => slide.title || slide.body);
}

function parseDelimitedRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  return lines.map((line) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"|"$/g, ""))
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

function BrowserRunDiagnosticsPanel({
  diagnostics,
  loading,
  onRefresh,
  onRun
}: {
  diagnostics: BrowserDiagnosticsResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onRun: () => void;
}) {
  const stages = diagnostics?.stages ?? [];
  const state = browserDiagnosticsPillState(diagnostics);
  return (
    <section className="browser-diagnostics-panel" aria-label="Browser Run diagnostics">
      <div className="section-heading">
        <div>
          <h3>Browser Run</h3>
          <p>{diagnostics?.summary ?? "Check Browser Rendering credentials, API access, CDP, and frame capture."}</p>
        </div>
        <span className="pill" data-state={state}>{diagnostics ? titleCase(diagnostics.status) : "Checking"}</span>
      </div>
      <div className="browser-diagnostics-actions">
        <button className="button button-compact" disabled={loading} onClick={onRefresh} type="button">
          Refresh
        </button>
        <button className="button button-compact button-primary" disabled={loading} onClick={onRun} type="button">
          {loading ? "Running" : "Run live check"}
        </button>
      </div>
      {stages.length > 0 ? (
        <ol className="diagnostic-stage-list">
          {stages.map((stage) => (
            <li data-state={stage.status} key={stage.id}>
              <span>{stage.label}</span>
              <small>{stage.summary}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="diagnostic-empty">No Browser Run diagnostics have been loaded yet.</p>
      )}
    </section>
  );
}

function CapabilityCanvas({
  learningActionId,
  onCurateLearning,
  onEditLearning,
  onRefresh,
  summary
}: {
  learningActionId: string | null;
  onCurateLearning: (id: string, status: LearningSuggestionStatus) => void;
  onEditLearning: (suggestion: LearningSuggestion) => void;
  onRefresh: () => void;
  summary: CapabilitySummary | null;
}) {
  const artifacts = summary?.artifacts?.artifacts ?? [];
  const skills = summary?.skills?.skills ?? [];
  const learning = summary?.learning;
  const learningSuggestions = learning?.suggestions?.items ?? [];
  const pendingLearningSuggestions = learningSuggestions.filter((suggestion) => suggestion.status === "pending");
  const mcpServers = summary?.mcp?.servers ?? [];
  const mcpObservability = summary?.mcpObservability;
  const contributions = summary?.contributions;
  const mcpEvents = mcpObservability?.recentEvents ?? [];
  const observedServers = mcpObservability?.servers ?? [];
  const executorStatus = summary?.executor?.status ?? "checking";

  return (
    <section className="capability-canvas" aria-label="Agent workspace canvas">
      <div className="section-heading">
        <div>
          <h3>Workspace Canvas</h3>
          <p>Artifacts, learning, skills, and execution status exposed through the hosted-agent SDK.</p>
        </div>
        <button className="button button-compact" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      <div className="canvas-grid">
        <Metric label="Artifacts" value={summary ? formatCapabilityCount(artifacts.length, summary.artifacts?.available) : "Loading"} />
        <Metric label="Learning" value={learning ? formatLearningState(learning) : "Loading"} />
        <Metric label="Skills" value={summary ? formatCapabilityCount(skills.length, summary.skills?.available) : "Loading"} />
        <Metric label="Executor" value={titleCase(executorStatus)} />
        <Metric label="PR lane" value={contributions ? (contributions.available ? "Ready" : "Token needed") : "Loading"} />
      </div>

      <div className="canvas-section">
        <strong>Library preview</strong>
        {artifacts.length > 0 ? (
          <ul className="compact-list">
            {artifacts.slice(0, 4).map((artifact, index) => (
              <li key={artifact.key + ":" + String(index)}>
                <span>{artifact.title || artifact.key}</span>
                <small>{artifact.type || "artifact"}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>{summary?.artifacts?.note ?? "No artifacts yet. Generated documents, code, and app previews will appear here when AGENT_STORAGE is bound."}</p>
        )}
      </div>

      <div className="canvas-section">
        <strong>Active capabilities</strong>
        <div className="subagent-chip-row">
          {skills.slice(0, 6).map((skill, index) => (
            <span className="pill" data-state={skill.enabled ? "ready" : undefined} key={skill.id + ":" + String(index)}>
              {skill.label}
            </span>
          ))}
          {mcpServers.slice(0, 4).map((server, index) => (
            <span className="pill" data-state={server.configured ? "ready" : undefined} key={server.id + ":" + String(index)}>
              {server.label}
            </span>
          ))}
        </div>
      </div>

      <div className="canvas-section">
        <strong>Contribution lane</strong>
        <p>
          {contributions?.note ?? "The agent can prepare upstream pull requests when GitHub credentials are configured."}
        </p>
        <div className="subagent-chip-row">
          <span className="pill" data-state={contributions?.available ? "ready" : undefined}>
            {contributions?.repository ?? "NeoFlux-Holdings/OpenThink"}
          </span>
          <span className="pill" data-state={contributions?.artifactSourceAvailable ? "ready" : undefined}>
            Artifacts source
          </span>
        </div>
      </div>

      <div className="canvas-section mcp-observability-panel" id="mcp-observability">
        <div className="canvas-section-heading">
          <strong>MCP activity</strong>
          <small>{mcpObservability ? formatMcpObservabilityState(mcpObservability) : "Loading"}</small>
        </div>
        {observedServers.length > 0 ? (
          <div className="mcp-observability-grid">
            {observedServers.slice(0, 4).map((server, index) => (
              <div className="mcp-server-card" key={server.name + ":" + String(index)}>
                <span>{server.name}</span>
                <small>{server.transport || "unknown"} / {server.calls ?? 0} calls / {server.failures ?? 0} failures</small>
              </div>
            ))}
          </div>
        ) : null}
        {mcpEvents.length > 0 ? (
          <ul className="compact-list mcp-event-list">
            {mcpEvents.slice(0, 5).map((event, index) => (
              <li key={event.id + ":" + String(index)}>
                <span>{event.server} / {event.tool}</span>
                <small>{event.status} / {event.latencyMs}ms / {truncateText(event.summary, 90)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>{mcpObservability?.note ?? "MCP and executor activity will appear here after the first tool discovery, executor call, or workspace RPC call."}</p>
        )}
      </div>

      <div className="canvas-section learning-review-panel" id="learning">
        <div className="canvas-section-heading">
          <strong>Learning review</strong>
          <small>{learning ? formatLearningState(learning) : "Loading"}</small>
        </div>
        {pendingLearningSuggestions.length > 0 ? (
          <ul className="learning-suggestions">
            {pendingLearningSuggestions.slice(0, 4).map((suggestion, index) => (
              <li key={suggestion.id + ":" + String(index)}>
                <div>
                  <span>{suggestion.title}</span>
                  <small>{suggestion.kind} / {truncateText(suggestion.summary, 120)}</small>
                </div>
                <div className="learning-actions">
                  <button
                    className="button button-compact"
                    disabled={learningActionId === suggestion.id}
                    onClick={() => onCurateLearning(suggestion.id, "accepted")}
                    type="button"
                  >
                    Accept
                  </button>
                  <button
                    className="button button-compact"
                    disabled={learningActionId === suggestion.id}
                    onClick={() => onEditLearning(suggestion)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="button button-compact"
                    disabled={learningActionId === suggestion.id}
                    onClick={() => onCurateLearning(suggestion.id, "rejected")}
                    type="button"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>{learning ? "No pending learning suggestions. Accepted and rejected items stay in the learning log." : "Learning status is loading."}</p>
        )}
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
    <section className="subagent-console" id="subagents" aria-label="Sub-agent console">
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
          subAgents.map((subAgent, index) => (
            <button
              className="subagent-row"
              data-active={String(selected?.id === subAgent.id)}
              key={subAgent.id + ":" + String(index)}
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
              {selected.skills.slice(0, 3).map((skill, index) => (
                <span className="pill" key={skill + ":" + String(index)}>{skill}</span>
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
              messages.slice(-6).map((message, index) => (
                <div className="subagent-message" data-role={message.role} key={message.id + ":" + String(index)}>
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

function formatSocketClose(event: CloseEvent) {
  const code = event.code ? `code ${event.code}` : "no close code";
  const reason = event.reason ? `, ${event.reason}` : "";
  const cleanliness = event.wasClean ? "clean" : "unclean";
  return `Closed ${cleanliness} (${code}${reason})`;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function searchPaletteResults(
  query: string,
  messages: UIMessage[],
  activeApprovalIds: ReadonlySet<string>,
  summary: CapabilitySummary | null,
  subAgents: SubAgent[]
): SearchResult[] {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const baseResults: SearchResult[] = [
    {
      id: "runtime",
      kind: "Runtime",
      title: "Runtime and approvals",
      detail: "Connection, model, Code Mode, executor, sandbox, and tool approvals.",
      target: "#runtime"
    },
    {
      id: "artifact-canvas",
      kind: "Artifact",
      title: "Artifact canvas",
      detail: "Documents, code, tables, generated app previews, and library items.",
      target: "#artifact-canvas"
    }
  ];

  const messageResults = messages
    .flatMap((message, index): SearchResult[] => {
      const text = messageSearchText(message, activeApprovalIds);
      if (!text) return [];
      return [{
        id: `message-${message.id || index}`,
        kind: "Thread" as const,
        title: message.role === "user" ? "User message" : "Assistant message",
        detail: truncateText(text, 120),
        target: "#chat-feed"
      }];
    });

  const artifactResults = (summary?.artifacts?.artifacts ?? []).map((artifact) => ({
    id: `artifact-${artifact.key}`,
    kind: "Artifact" as const,
    title: artifact.title || artifact.key,
    detail: [artifact.type || "artifact", artifact.uploaded ? formatRelativeTime(artifact.uploaded) : ""].filter(Boolean).join(" / "),
    target: "#artifact-canvas"
  }));

  const skillResults = (summary?.skills?.skills ?? []).map((skill) => ({
    id: `skill-${skill.id}`,
    kind: "Skill" as const,
    title: skill.label,
    detail: skill.enabled ? "Enabled skill" : "Available skill",
    target: "#skills"
  }));

  const memoryResults = (summary?.learning?.memories?.items ?? []).map((item, index) => ({
    id: `memory-${index}`,
    kind: "Memory" as const,
    title: "Memory suggestion",
    detail: truncateText(unknownSearchText(item), 120),
    target: "#learning"
  }));

  const subAgentResults = subAgents.map((subAgent) => ({
    id: `subagent-${subAgent.id}`,
    kind: "Sub-agent" as const,
    title: subAgent.name,
    detail: truncateText(`${subAgent.status} / ${subAgent.purpose} / ${subAgent.summary}`, 120),
    target: "#subagents"
  }));

  const allResults = [
    ...baseResults,
    ...messageResults,
    ...artifactResults,
    ...memoryResults,
    ...skillResults,
    ...subAgentResults
  ];

  if (!normalizedQuery) return allResults.slice(0, 10);
  return allResults
    .filter((result) => `${result.kind} ${result.title} ${result.detail}`.toLowerCase().includes(normalizedQuery))
    .slice(0, 14);
}

function messageSearchText(message: UIMessage, activeApprovalIds: ReadonlySet<string>) {
  return compactMessageParts(message.parts)
    .filter(({ part }) => partHasVisibleContent(part, activeApprovalIds))
    .map(({ part }) => {
      if (isTextUIPart(part)) return part.text;
      if (isToolUIPart(part)) {
        const name = toolDisplayTitle(getToolName(part), getToolInput(part));
        const state = toolStateLabel(toolPartDisplayState(part, activeApprovalIds));
        return `${name} ${state}`;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function unknownSearchText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record.text ?? record.summary ?? record.label ?? record.title ?? record.id;
    if (typeof preferred === "string") return preferred;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

type McpServerState = {
  connectionState?: string;
  state?: string;
  tools?: unknown[];
};

type RuntimeHealth = {
  cloudAgentInstance?: {
    execution?: RuntimeExecutionState;
    codeMode?: RuntimeCodeModeState;
    workspace?: RuntimeWorkspaceState;
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

type RuntimeCodeModeState = {
  enabled?: boolean;
  default?: boolean;
  toolShape?: string;
};

type RuntimeWorkspaceState = {
  firstClass?: boolean;
  orchestrator?: {
    enabled?: boolean;
    autoSpunUp?: boolean;
    className?: string;
  };
  contextStore?: {
    vectorizeConfigured?: boolean;
  };
};

type BrowserDiagnosticsResponse = {
  ok: boolean;
  status: string;
  mode: "read-only" | "live" | string;
  summary: string;
  stages: BrowserDiagnosticsStage[];
  accountIdConfigured?: boolean;
  tokenConfigured?: boolean;
  requiredPermission?: string;
  docs?: string;
  sessionId?: string;
  targetId?: string;
  hasWebSocketDebuggerUrl?: boolean;
  frameCaptured?: boolean;
  frameBytes?: number;
  error?: string;
};

type BrowserDiagnosticsStage = {
  id: string;
  label: string;
  status: "complete" | "warning" | "error" | "skipped" | string;
  summary: string;
  detail?: string;
  at?: string;
};

type CapabilitySummary = {
  skills: SkillListResponse | null;
  learning: LearningResponse | null;
  artifacts: ArtifactListResponse | null;
  contributions: ContributionStatusResponse | null;
  executor: ExecutorResponse | null;
  mcp: McpServerCatalogResponse | null;
  mcpObservability: McpObservabilityResponse | null;
};

type SearchResult = {
  id: string;
  kind: "Thread" | "Artifact" | "Memory" | "Skill" | "Sub-agent" | "Runtime";
  title: string;
  detail: string;
  target: string;
};

type SkillListResponse = {
  available?: boolean;
  skills?: Array<{
    id: string;
    label: string;
    enabled: boolean;
  }>;
  note?: string;
};

type LearningResponse = {
  status?: string;
  trainMode?: {
    available?: boolean;
    teachMode?: boolean;
  };
  memories?: {
    available?: boolean;
    pending?: number;
    items?: unknown[];
  };
  skills?: {
    available?: boolean;
    pending?: number;
    suggestions?: LearningSuggestion[];
  };
  suggestions?: {
    pending?: number;
    accepted?: number;
    rejected?: number;
    items?: LearningSuggestion[];
  };
};

type LearningSuggestionStatus = "pending" | "accepted" | "rejected";

type LearningSuggestion = {
  id: string;
  kind: "memory" | "skill" | "rubric" | "workflow" | string;
  title: string;
  summary: string;
  status: LearningSuggestionStatus;
  source?: string;
  updatedAt?: string;
};

type ArtifactListItem = {
  key: string;
  title?: string;
  type?: string;
  uploaded?: string | null;
  size?: number | null;
  versions?: number;
};

type ArtifactVersion = {
  key: string;
  versionKey: string;
  label: string;
  current?: boolean;
  uploaded?: string | null;
  size?: number | null;
};

type ArtifactDetailResponse = {
  key: string;
  versionKey?: string;
  title?: string;
  type?: string;
  text?: string;
  versions?: ArtifactVersion[];
};

type ArtifactCanvasMode = "single" | "grid" | "stack";

type ArtifactListResponse = {
  available?: boolean;
  note?: string;
  artifacts?: ArtifactListItem[];
};

type ContributionStatusResponse = {
  available?: boolean;
  endpoint?: string;
  repository?: string;
  baseBranch?: string;
  tokenConfigured?: boolean;
  artifactSourceAvailable?: boolean;
  sandboxSourceAvailable?: boolean;
  note?: string;
};

type ExecutorResponse = {
  configured?: boolean;
  status?: string;
};

type McpServerCatalogResponse = {
  servers?: Array<{
    id: string;
    label: string;
    configured?: boolean;
  }>;
};

type McpObservabilityResponse = {
  available?: boolean;
  status?: string;
  note?: string;
  totals?: {
    calls?: number;
    failures?: number;
    servers?: number;
  };
  servers?: Array<{
    name: string;
    transport?: string;
    calls?: number;
    failures?: number;
    avgLatencyMs?: number;
  }>;
  recentEvents?: Array<{
    id: string;
    server: string;
    tool: string;
    transport?: string;
    status: string;
    latencyMs: number;
    summary: string;
    createdAt?: string;
  }>;
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
    'await agent.sendSubAgentMessage(child.subAgent.id, "Inspect the current deploy path.");',
    "await agent.addMemory('Prefer short deploy-readiness briefs.');",
    "const artifacts = await agent.listArtifacts();",
    "const learning = await agent.learning();",
    "console.log(profile.kind, artifacts.available, learning.trainMode.available);"
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

function latestUserTextMessageAfter(messages: UIMessage[], startIndex: number) {
  for (let messageIndex = messages.length - 1; messageIndex >= startIndex; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "user") continue;

    const text = messageTextContent(message);
    if (text) return { id: message.id, index: messageIndex, text };
  }
  return null;
}

function messageTextContent(message: UIMessage) {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
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
  const summaries = parts.map(({ part }) => summarizeToolPart(part, activeApprovalIds));
  const names = uniqueDisplayNames(summaries.map((summary) => summary.title));
  const states = parts.map(({ part }) => toolSummaryState(part, activeApprovalIds));
  const activeApprovalCount = parts.filter(({ part }) => toolPartHasActiveApproval(part, activeApprovalIds)).length;
  const state = toolGroupState(states, activeApprovalCount);
  const countLabel = parts.length === 1 ? "1 tool step" : parts.length + " tool steps";
  const title = parts.length === 1 ? summaries[0]?.title ?? "Tool step" : countLabel;
  const detailParts = [parts.length === 1 ? summaries[0]?.description : formatToolNameList(names), formatToolStateList(states)]
    .filter(Boolean);

  return {
    defaultOpen: activeApprovalCount > 0,
    detail: detailParts.join(" - ") || countLabel,
    state,
    title
  };
}

type ToolPresentation = {
  rawName: string;
  title: string;
  description: string | null;
  outcome: string | null;
};

function summarizeToolPart(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>): ToolPresentation {
  const toolName = isToolUIPart(part) ? getToolName(part) : "tool";
  const input = isToolUIPart(part) ? getToolInput(part) : null;
  const output = isToolUIPart(part) ? getToolOutput(part) : null;
  const displayState = isToolUIPart(part) ? toolPartDisplayState(part, activeApprovalIds) : "tool";
  const title = toolDisplayTitle(toolName, input);
  const description = toolInputSummary(toolName, input);
  const outcome = toolOutcomeSummary(displayState, output);

  return {
    rawName: toolName,
    title,
    description: description && description !== title ? description : null,
    outcome
  };
}

function uniqueDisplayNames(names: string[]) {
  return Array.from(new Set(names.filter(Boolean)));
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

function toolStateLabel(state: string) {
  switch (state) {
    case "complete":
    case "output-available":
      return "Complete";
    case "streaming":
    case "input-streaming":
    case "input-available":
      return "Running";
    case "waiting-approval":
      return "Needs approval";
    case "approved":
    case "approval-responded":
      return "Approved";
    case "expired-approval":
      return "Expired";
    case "output-error":
    case "error":
      return "Error";
    case "denied":
      return "Rejected";
    default:
      return titleCaseWords(state.replace(/-/g, " "));
  }
}

function toolDisplayTitle(toolName: string, input: unknown) {
  const normalized = normalizeToolName(toolName);
  const codeTask = codeTaskSummary(input);

  if (normalized === "search_cloudflare_documentation") return "Search Cloudflare docs";
  if (normalized === "confirmCloudflareOperation") return "Request Cloudflare approval";
  if (normalized === "setActiveGoal") return "Set active goal";
  if (normalized === "getUserTimezone") return "Read browser time context";
  if (normalized === "createSubAgent") return "Create sub-agent";
  if (normalized === "sendSubAgentMessage") return "Message sub-agent";
  if (normalized === "summarizeSubAgent") return "Summarize sub-agent";
  if (normalized === "controlSubAgent") return "Control sub-agent";
  if (normalized === "search") return codeTask ? "Inspect API shape" : "Search available tools";
  if (normalized === "execute") return codeTask ? "Run Cloudflare operation" : "Execute tool";

  return titleCaseWords(normalized.replace(/[_-]/g, " "));
}

function toolInputSummary(toolName: string, input: unknown) {
  const normalized = normalizeToolName(toolName);
  const inputRecord = asRecord(input);
  if (!inputRecord) return null;

  const query = textField(inputRecord, "query");
  if (query) return "Query: " + truncateText(query, 140);

  const operation = textField(inputRecord, "operation");
  if (operation) {
    const resources = stringArrayField(inputRecord, "resources");
    return resources.length > 0
      ? operation + ". Resources: " + resources.slice(0, 4).join(", ")
      : operation;
  }

  const goal = textField(inputRecord, "goal") ?? textField(inputRecord, "objective");
  if (goal) return "Goal: " + truncateText(goal, 140);

  const subAgentName = textField(inputRecord, "name") ?? textField(inputRecord, "subAgentId");
  const message = textField(inputRecord, "message") ?? textField(inputRecord, "prompt") ?? textField(inputRecord, "task");
  if (subAgentName && message) return subAgentName + ": " + truncateText(message, 140);
  if (message) return truncateText(message, 160);

  const codeTask = codeTaskSummary(input);
  if (codeTask) return codeTask;

  if (normalized === "getUserTimezone") return "Uses the browser timezone for date and time grounding.";
  return null;
}

function toolOutcomeSummary(state: string, output: unknown) {
  if (state === "waiting-approval") return "Waiting for your decision before continuing.";
  if (state === "expired-approval") return "Older approval. Send a fresh request to run this again.";
  if (state === "denied") return "Rejected by owner.";
  if (state === "input-streaming" || state === "input-available" || state === "streaming") return "Preparing the tool request.";
  if (state === "approved" || state === "approval-responded") return "Approval recorded. Waiting for the result.";

  const outputSummary = summarizeToolOutput(output);
  if (outputSummary) return outputSummary;
  if (state === "output-error" || state === "error") return "Tool returned an error.";
  if (state === "output-available" || state === "complete") return "Completed.";
  return null;
}

function summarizeToolOutput(output: unknown): string | null {
  if (!output) return null;

  const text = toolContentText(output);
  if (text) {
    const parsed = parseJsonText(text);
    if (parsed !== null) return summarizeParsedToolOutput(parsed);
    return truncateText(normalizeWhitespace(text), 220);
  }

  return summarizeParsedToolOutput(output);
}

function summarizeParsedToolOutput(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "No matching results.";
    const endpoints = value.map(endpointSummary).filter((item): item is string => Boolean(item));
    if (endpoints.length > 0) {
      return "Found " + pluralize(value.length, "endpoint") + ": " + formatInlineList(endpoints, 3);
    }
    return "Returned " + pluralize(value.length, "item") + ".";
  }

  const record = asRecord(value);
  if (!record) return truncateText(normalizeWhitespace(String(value)), 220);

  const error = textField(record, "error") ?? textField(record, "message");
  if (error && (record.success === false || "error" in record)) return "Error: " + truncateText(error, 180);

  const directUrl = textField(record, "url") ?? textField(record, "deployment_url") ?? textField(record, "preview_url");
  if (directUrl) return "Created or updated resource: " + directUrl;

  const endpointSummaryText = summarizeEndpointCollections(record);
  if (endpointSummaryText) return endpointSummaryText;

  const operationSummary = textField(record, "summary") ?? textField(record, "operation");
  if (operationSummary) return truncateText(operationSummary, 180);

  const result = record.result;
  const resultRecord = asRecord(result);
  if (resultRecord) {
    const url = textField(resultRecord, "url") ?? textField(resultRecord, "deployment_url");
    if (url) return "Created or updated resource: " + url;

    const name = textField(resultRecord, "name") ?? textField(resultRecord, "id");
    if (name && record.success === true) return "Cloudflare API succeeded for " + name + ".";
  }

  if (record.success === true) return "Cloudflare API request succeeded.";
  if (record.success === false) return "Cloudflare API request failed.";

  const nestedText = toolContentText(record);
  if (nestedText && nestedText !== String(value)) return truncateText(normalizeWhitespace(nestedText), 220);
  return "Returned structured data.";
}

function summarizeEndpointCollections(record: Record<string, unknown>) {
  const sections = [
    ["workerEndpoints", "Worker endpoint"],
    ["workers", "Worker endpoint"],
    ["pagesEndpoints", "Pages endpoint"],
    ["pages", "Pages endpoint"],
    ["routes", "route"]
  ] as const;

  for (const [key, label] of sections) {
    const value = record[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    const endpoints = value.map(endpointSummary).filter((item): item is string => Boolean(item));
    if (endpoints.length > 0) {
      return "Found " + pluralize(value.length, label) + ": " + formatInlineList(endpoints, 3);
    }
    return "Found " + pluralize(value.length, label) + ".";
  }

  return null;
}

function endpointSummary(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const method = textField(record, "method")?.toUpperCase();
  const path = textField(record, "path");
  const summary = textField(record, "summary");
  if (!method && !path) return null;
  return [method, path, summary ? "- " + summary : null].filter(Boolean).join(" ");
}

function toolContentText(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return typeof value === "string" ? value : null;

  const content = record.content;
  if (Array.isArray(content)) {
    const textParts = content
      .map((item) => {
        const itemRecord = asRecord(item);
        return itemRecord && itemRecord.type === "text" ? textField(itemRecord, "text") : null;
      })
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join("\n\n");
  }

  return textField(record, "text");
}

function codeTaskSummary(input: unknown) {
  const record = asRecord(input);
  const code = record ? textField(record, "code") : null;
  if (!code) return null;

  const comment = firstCodeComment(code);
  if (comment) return truncateText(comment, 180);

  const requestTarget = firstCloudflareRequestTarget(code);
  return requestTarget ? "Cloudflare API request: " + requestTarget : "Inline tool code.";
}

function firstCodeComment(code: string) {
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("//")) continue;
    const comment = line.replace(/^\/\/+/, "").trim();
    if (comment) return sentenceCase(comment);
  }
  return null;
}

function firstCloudflareRequestTarget(code: string) {
  const methodMatch = code.match(/method:\s*["']([A-Z]+)["']/);
  const pathMatch = code.match(/path:\s*`([^`]+)`|path:\s*["']([^"']+)["']/);
  const method = methodMatch?.[1];
  const path = pathMatch?.[1] ?? pathMatch?.[2];
  if (!method && !path) return null;
  return [method, path].filter(Boolean).join(" ");
}

function normalizeToolName(toolName: string) {
  return toolName
    .replace(/^functions\./, "")
    .replace(/^tool_[A-Za-z0-9]+_/, "");
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed || !/^[\[{"]/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function formatInlineList(items: string[], limit: number) {
  const visible = items.slice(0, limit);
  const suffix = items.length > limit ? " +" + String(items.length - limit) + " more" : "";
  return visible.join("; ") + suffix;
}

function pluralize(count: number, noun: string) {
  return String(count) + " " + noun + (count === 1 ? "" : "s");
}

function sentenceCase(text: string) {
  const trimmed = normalizeWhitespace(text);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

function titleCaseWords(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number) {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 1).trimEnd() + "...";
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
  if (error.message.includes("Maximum update depth exceeded")) {
    return "The stream hit a React rendering guard. Stop the current run or send the request again when the stream is idle.";
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
    message.includes("Maximum update depth exceeded") ||
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
  if (policy === "full-auto") return "Full auto";
  return "Auto";
}

function formatCodeMode(state: RuntimeCodeModeState | undefined) {
  if (!state) return "Default on";
  if (state.enabled === false) return "Off";
  return state.toolShape ? `On (${state.toolShape})` : "On";
}

function formatWorkspaceState(state: RuntimeWorkspaceState | undefined) {
  if (!state?.orchestrator?.enabled) return "Default pending";
  return state.orchestrator.autoSpunUp ? "Orchestrator ready" : "Manual";
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

let trainStepIdSequence = 0;

function defaultTrainPlanState(): TrainPlanState {
  return {
    objective: "",
    steps: [],
    draftVisible: false,
    granular: false
  };
}

function createTrainStep(text: string, approved = false): TrainStep {
  trainStepIdSequence += 1;
  return {
    id: "train-step-" + Date.now().toString(36) + "-" + String(trainStepIdSequence),
    text,
    approved
  };
}

function draftTrainPlan(objectiveText: string, previous?: TrainPlanState): TrainPlanState {
  const objective = normalizeTrainObjective(objectiveText);
  const steps = [
    "Confirm the objective, assumptions, constraints, and success criteria.",
    "Inspect the current runtime, tools, data, and affected product surfaces.",
    "Propose the smallest useful implementation path, including risks and expected artifacts.",
    "Execute only the approved plan, stopping if a material risk or missing permission appears.",
    "Verify the result, summarize what changed, and suggest whether this should become a reusable skill."
  ];

  return {
    objective,
    steps: steps.map((step) => createTrainStep(step)),
    draftVisible: true,
    granular: previous?.granular ?? false
  };
}

function normalizeTrainObjective(text: string) {
  return text.replace(/^\/train\b/i, "").trim();
}

function addTrainStep(plan: TrainPlanState): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: [
      ...plan.steps,
      createTrainStep("Add the next approved step here.")
    ]
  };
}

function updateTrainStep(
  plan: TrainPlanState,
  id: string,
  updates: Partial<Pick<TrainStep, "approved" | "text">>
): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: plan.steps.map((step) => (step.id === id ? { ...step, ...updates } : step))
  };
}

function removeTrainStep(plan: TrainPlanState, id: string): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: plan.steps.filter((step) => step.id !== id)
  };
}

function moveTrainStep(plan: TrainPlanState, id: string, direction: -1 | 1): TrainPlanState {
  const index = plan.steps.findIndex((step) => step.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= plan.steps.length) return plan;
  const steps = [...plan.steps];
  const [step] = steps.splice(index, 1);
  if (!step) return plan;
  steps.splice(nextIndex, 0, step);
  return {
    ...plan,
    draftVisible: true,
    steps
  };
}

function approveAllTrainSteps(plan: TrainPlanState): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: plan.steps.map((step) => ({ ...step, approved: Boolean(step.text.trim()) }))
  };
}

function trainPlanReadyToRun(plan: TrainPlanState) {
  const usableSteps = cleanTrainSteps(plan.steps);
  if (!plan.draftVisible || !plan.objective.trim() || usableSteps.length === 0) return false;
  if (plan.granular) return usableSteps.some((step) => step.approved);
  return usableSteps.every((step) => step.approved);
}

function trainPlanReadinessCopy(plan: TrainPlanState) {
  if (!plan.objective.trim()) return "Add an objective before running.";
  if (cleanTrainSteps(plan.steps).length === 0) return "Add at least one step before running.";
  if (plan.granular) return "Approve at least one step, then Send will execute only the approved steps.";
  return "Approve every step or switch to step-by-step approval before running.";
}

function buildTrainModeSubmission(
  composerText: string,
  plan: TrainPlanState
): { ready: false; objective: string } | { ready: true; text: string } {
  const objective = normalizeTrainObjective(plan.draftVisible ? plan.objective : composerText);
  if (!trainPlanReadyToRun({ ...plan, objective })) {
    return { ready: false, objective };
  }
  const usableSteps = cleanTrainSteps(plan.steps);
  const selectedSteps = plan.granular ? usableSteps.filter((step) => step.approved) : usableSteps;
  return {
    ready: true,
    text: formatTrainPlanMessage(objective, plan, selectedSteps)
  };
}

function cleanTrainSteps(steps: TrainStep[]) {
  return steps.filter((step) => step.text.trim().length > 0);
}

function formatTrainPlanMessage(objective: string, plan: TrainPlanState, selectedSteps: TrainStep[]) {
  const stepsText = selectedSteps
    .map((step, index) => String(index + 1) + ". " + step.text.trim())
    .join("\n");
  const executionMode = plan.granular
    ? "Step-by-step: execute only the approved steps now, report progress, and stop for the next approval."
    : "Full plan: all steps are approved; execute the full plan unless a material risk appears.";

  return [
    "/train " + objective.trim(),
    "",
    "Approved train plan:",
    stepsText,
    "",
    "Execution mode: " + executionMode,
    "After completion, offer to save the useful pattern as a reusable skill."
  ].join("\n");
}

function applyRunModeToMessage(text: string, mode: RunMode) {
  if (mode === "plan-first") {
    return [
      "Plan first before acting. Do not run mutating tools until I approve the proposed plan.",
      "",
      text
    ].join("\n");
  }
  if (mode === "train") {
    return text.startsWith("/train") ? text : "/train " + text;
  }
  return text;
}

function formatCapabilityCount(count: number, available: boolean | undefined) {
  if (available === false) return "Not bound";
  return count === 0 ? "None yet" : String(count);
}

function formatLearningState(learning: LearningResponse) {
  if (learning.trainMode?.available === false) return "Pending";
  const pending =
    Number(learning.memories?.pending ?? 0) +
    Number(learning.skills?.pending ?? 0);
  return pending > 0 ? String(pending) + " pending" : "Train ready";
}

function formatMcpObservabilityState(observability: McpObservabilityResponse) {
  if (observability.available === false) return "Preview";
  const calls = Number(observability.totals?.calls ?? 0);
  const failures = Number(observability.totals?.failures ?? 0);
  if (calls === 0) return "No calls yet";
  return failures > 0 ? `${calls} calls / ${failures} failures` : `${calls} calls`;
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

function browserDiagnosticsPillState(diagnostics: BrowserDiagnosticsResponse | null) {
  if (!diagnostics) return undefined;
  if (diagnostics.ok) return "ready";
  if (diagnostics.status === "configured") return "ready";
  if (diagnostics.status === "missing-configuration") return "error";
  if (diagnostics.status === "api-unavailable" || diagnostics.status === "live-check-failed") return "error";
  return undefined;
}

async function getInitialAgentMessages({ url }: { url?: string | null }) {
  return getAgentMessages(url ?? undefined);
}

async function getAgentMessages(baseUrl?: string): Promise<UIMessage[]> {
  const response = await fetch(agentMessagesUrl(baseUrl), { credentials: "include" });
  if (!response.ok) return [];

  const payload = await response.json().catch(() => null);
  if (Array.isArray(payload)) return uniqueMessages(payload);
  if (payload && typeof payload === "object" && Array.isArray((payload as { messages?: unknown }).messages)) {
    return uniqueMessages((payload as { messages: UIMessage[] }).messages);
  }
  return [];
}

function agentMessagesUrl(baseUrl?: string) {
  const url = new URL(baseUrl ?? window.location.href);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat-history")
    ? path
    : path.includes("/agents/")
      ? path + "/chat-history"
      : "/agents/personal-chat-agent/default/chat-history";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function uniqueMessages(messages: UIMessage[]) {
  const seen = new Map<string, number>();
  return messages.map((message, index) => {
    const id = message.id || `${message.role}:${index}`;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return count === 0 ? { ...message, id } : { ...message, id: `${id}:${count}` };
  });
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

async function fetchBrowserDiagnostics(init?: RequestInit): Promise<BrowserDiagnosticsResponse> {
  const response = await fetch("/browser/diagnostics", {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (data && typeof data === "object" && Array.isArray((data as BrowserDiagnosticsResponse).stages)) {
    return data as BrowserDiagnosticsResponse;
  }
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Browser Run diagnostics failed.");
  }
  return data as BrowserDiagnosticsResponse;
}

async function optionalJsonFetch<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    return await jsonFetch<T>(url, init);
  } catch {
    return null;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
