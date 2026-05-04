import { useCallback, useMemo, useState } from "react";

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
}

export interface UseAgentChatOptions {
  endpoint?: string;
  initialMessages?: ChatMessage[];
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
  const [messages, setMessages] = useState<ChatMessage[]>(
    options.initialMessages ?? [
      {
        id: "system-1",
        role: "assistant",
        content:
          "ChatDO is attached. Messages persist to SQLite and stream through the agent WebSocket channel.",
        createdAt: new Date().toISOString()
      }
    ]
  );
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(null);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed })
        });

        if (!response.ok) {
          throw new Error(`Chat request failed with ${response.status}`);
        }

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
        setError(caught instanceof Error ? caught.message : "Chat request failed.");
      } finally {
        setIsSending(false);
      }
    },
    [endpoint, input]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return useMemo(
    () => ({
      messages,
      input,
      setInput,
      send,
      isSending,
      error,
      reset
    }),
    [messages, input, send, isSending, error, reset]
  );
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
