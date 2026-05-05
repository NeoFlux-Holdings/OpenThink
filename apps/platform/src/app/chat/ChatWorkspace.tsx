"use client";

import {
  Activity,
  Bot,
  Database,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  User
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useAgentChat } from "@open-think/ui";

const runtimeRows = [
  { label: "Persistence", value: "Embedded SQLite", Icon: Database },
  { label: "Transport", value: "SSE stream, Agents WebSocket ready", Icon: Radio },
  { label: "Auth", value: "Access or JWT at Worker entry", Icon: ShieldCheck }
] as const;

export function ChatWorkspace() {
  const {
    messages,
    input,
    setInput,
    send,
    stop,
    clearHistory,
    isSending,
    status,
    transport,
    error
  } = useAgentChat({ loadHistory: true });

  return (
    <section className="workspace-page" aria-label="Agent chat workspace">
      <div className="surface chat-shell">
        <div className="surface-header">
          <div className="page-kicker">ChatDO</div>
          <h1>Agent conversation</h1>
          <p>Durable history, streamed responses, native Agents SDK WebSocket path for deployed runtimes.</p>
          <div className="chat-status" data-state={status}>
            <Activity size={15} aria-hidden="true" />
            <span>{status === "idle" ? "Ready" : status}</span>
            <span>{transport.toUpperCase()}</span>
          </div>
        </div>
        <div className="message-list" aria-live="polite">
          {messages.map((message) => (
            <div
              className="message-row"
              data-pending={String(Boolean(message.metadata?.streaming))}
              data-role={message.role}
              key={message.id}
            >
              <span className="message-avatar">
                {message.role === "user" ? (
                  <User size={16} aria-hidden="true" />
                ) : (
                  <Bot size={16} aria-hidden="true" />
                )}
              </span>
              <span className="message-bubble markdown-message">
                <Streamdown>{message.content}</Streamdown>
              </span>
            </div>
          ))}
          {error ? <p className="notice">{error}</p> : null}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            void send(String(formData.get("message") ?? ""));
          }}
        >
          <input
            aria-label="Message"
            name="message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask the agent to inspect, deploy, or repair a Cloudflare resource"
          />
          <div className="composer-actions">
            <button className="button button-primary" type="submit" disabled={isSending}>
              <Send size={16} aria-hidden="true" />
              {isSending ? "Sending" : "Send"}
            </button>
            <button
              aria-label="Stop response"
              className="button-icon"
              disabled={!isSending}
              onClick={stop}
              title="Stop response"
              type="button"
            >
              <Square size={15} aria-hidden="true" />
            </button>
            <button
              aria-label="Clear history"
              className="button-icon"
              disabled={isSending}
              onClick={() => void clearHistory()}
              title="Clear history"
              type="button"
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>

      <aside className="surface">
        <div className="surface-header">
          <div className="page-kicker">Runtime</div>
          <h2>Live control plane</h2>
          <p>Each user maps to one durable chat coordinator.</p>
        </div>
        <div className="surface-body">
          <div className="metric-grid">
            <div className="metric">
              <strong>1</strong>
              <span>ChatDO per user</span>
            </div>
            <div className="metric">
              <strong>0ms</strong>
              <span>Idle billable duration</span>
            </div>
          </div>
          {runtimeRows.map(({ label, value, Icon }) => (
            <div className="terminal-row" key={label}>
              <Icon size={17} color="var(--accent-strong)" aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <br />
                <span className="field-hint">{value}</span>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}
