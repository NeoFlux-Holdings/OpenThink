import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UiAgentState {
  id: string;
  status: "idle" | "connecting" | "ready" | "error";
  lastError?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface UseAgentChatOptions {
  endpoint?: string;
  initialMessages?: ChatMessage[];
  loadHistory?: boolean;
  stream?: boolean;
}

export type AgentChatStatus = "idle" | "sending" | "streaming" | "error";
export type AgentChatTransport = "sse" | "json";

interface ChatSseEvent {
  event: string;
  data: Record<string, unknown>;
}

export function useAgent(id = "personal-agent") {
  const [state, setState] = useState<UiAgentState>({
    id,
    status: "idle"
  });

  const connect = useCallback(() => {
    setState({ id, status: "ready" });
  }, [id]);

  const disconnect = useCallback(() => {
    setState({ id, status: "idle" });
  }, [id]);

  return { state, connect, disconnect };
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const endpoint = options.endpoint ?? "/api/chat";
  const stream = options.stream ?? true;
  const loadHistory = options.loadHistory ?? false;
  const [messages, setMessages] = useState<ChatMessage[]>(
    options.initialMessages ?? [
      {
        id: "system-1",
        role: "assistant",
        content:
          "ChatDO is attached. Messages persist to SQLite and stream through the agent channel.",
        createdAt: new Date().toISOString()
      }
    ]
  );
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<AgentChatStatus>("idle");
  const [transport, setTransport] = useState<AgentChatTransport>(stream ? "sse" : "json");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loadHistory) return;

    let cancelled = false;
    const separator = endpoint.includes("?") ? "&" : "?";

    void fetch(`${endpoint}${separator}history=1`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as {
          messages?: ChatMessage[];
        };
        if (!cancelled && Array.isArray(payload.messages) && payload.messages.length > 0) {
          setMessages(payload.messages);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [endpoint, loadHistory]);

  const send = useCallback(
    async (content = input) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString()
      };

      setMessages((current) => [...current, userMessage]);
      setInput("");
      setIsSending(true);
      setStatus(stream ? "streaming" : "sending");
      setTransport(stream ? "sse" : "json");
      setError(null);

      const assistantDraftId = crypto.randomUUID();
      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(stream ? { Accept: "text/event-stream" } : {})
          },
          body: JSON.stringify({ message: trimmed, stream }),
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`Chat request failed with ${response.status}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (stream && response.body && contentType.includes("text/event-stream")) {
          setMessages((current) => [
            ...current,
            {
              id: assistantDraftId,
              role: "assistant",
              content: "",
              createdAt: new Date().toISOString(),
              metadata: { streaming: true }
            }
          ]);

          let accumulated = "";
          let finalMessage: ChatMessage | undefined;
          await readSse(response, (event) => {
            if (event.event === "delta") {
              const next = typeof event.data.content === "string" ? event.data.content : "";
              accumulated += next;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantDraftId
                    ? { ...message, content: accumulated }
                    : message
                )
              );
            }

            if (event.event === "done" && isRecord(event.data.message)) {
              const message = event.data.message;
              finalMessage = {
                id: typeof message.id === "string" ? message.id : assistantDraftId,
                role: "assistant",
                content:
                  typeof message.content === "string" ? message.content : accumulated,
                createdAt:
                  typeof message.createdAt === "string"
                    ? message.createdAt
                    : new Date().toISOString(),
                metadata: {
                  ...(isRecord(message.metadata) ? message.metadata : {}),
                  streaming: false,
                  ...(event.data.toolResults ? { toolResults: event.data.toolResults } : {})
                }
              };
            }
          });

          setMessages((current) =>
            current.map((message) =>
              message.id === assistantDraftId
                ? finalMessage ?? { ...message, metadata: { ...message.metadata, streaming: false } }
                : message
            )
          );
          return;
        }

        setTransport("json");
        const assistant = (await response.json()) as Pick<
          ChatMessage,
          "id" | "role" | "content"
        >;

        setMessages((current) => [
          ...current,
          {
            id: assistant.id,
            role: assistant.role,
            content: assistant.content,
            createdAt: new Date().toISOString()
          }
        ]);
      } catch (caught) {
        const message =
          caught instanceof DOMException && caught.name === "AbortError"
            ? "Response stopped."
            : caught instanceof Error
              ? caught.message
              : "Chat request failed.";
        setError(message);
        setStatus("error");
        return;
      } finally {
        abortRef.current = null;
        setIsSending(false);
        setStatus((current) => (current === "error" ? current : "idle"));
      }
    },
    [endpoint, input, stream]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus("idle");
  }, []);

  const clearHistory = useCallback(async () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStatus("idle");

    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok && response.status !== 404 && response.status !== 405) {
        throw new Error(`Clear history failed with ${response.status}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Clear history failed.");
      setStatus("error");
    }
  }, [endpoint]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return useMemo(
    () => ({
      messages,
      input,
      setInput,
      send,
      stop,
      isSending,
      status,
      transport,
      error,
      reset,
      clearHistory
    }),
    [
      messages,
      input,
      send,
      stop,
      isSending,
      status,
      transport,
      error,
      reset,
      clearHistory
    ]
  );
}

async function readSse(
  response: Response,
  onEvent: (event: ChatSseEvent) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) onEvent(event);
    }
  }

  const event = parseSseBlock(buffer);
  if (event) onEvent(event);
}

function parseSseBlock(block: string): ChatSseEvent | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) return null;

  try {
    return { event, data: JSON.parse(data.join("\n")) as Record<string, unknown> };
  } catch {
    return { event, data: { text: data.join("\n") } };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface TerminalLine {
  id: string;
  content: string;
  createdAt: string;
}

export function useTerminal(endpoint = "/api/terminal") {
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: "boot",
      content:
        "TerminalDO ready\ntransport: websocket-pty\nshell: /bin/bash",
      createdAt: new Date().toISOString()
    }
  ]);
  const [command, setCommand] = useState("ls -la /workspace");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (nextCommand = command) => {
      const trimmed = nextCommand.trim();
      if (!trimmed) return;

      setIsRunning(true);
      setError(null);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: trimmed })
        });

        if (!response.ok) {
          throw new Error(`Terminal request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { output: string };
        setLines((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            content: payload.output,
            createdAt: new Date().toISOString()
          }
        ]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Terminal request failed.");
      } finally {
        setIsRunning(false);
      }
    },
    [command, endpoint]
  );

  return useMemo(
    () => ({
      lines,
      command,
      setCommand,
      run,
      isRunning,
      error
    }),
    [lines, command, run, isRunning, error]
  );
}
