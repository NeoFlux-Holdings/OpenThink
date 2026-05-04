"use client";

import { Bot, Database, Radio, Send, ShieldCheck, User } from "lucide-react";
import { Streamdown } from "streamdown";
import { useAgentChat } from "@open-think/ui";

const runtimeRows = [
  { label: "Persistence", value: "Embedded SQLite", Icon: Database },
  { label: "Transport", value: "Hibernatable WebSocket", Icon: Radio },
  { label: "Auth", value: "Access or JWT at Worker entry", Icon: ShieldCheck }
] as const;

export function ChatWorkspace() {
  const { messages, input, setInput, send, isSending, error } = useAgentChat();

  return (
    <section className="workspace-page" aria-label="Agent chat workspace">
      <div className="surface chat-shell">
        <div className="surface-header">
          <div className="page-kicker">ChatDO</div>
          <h1>Agent conversation</h1>
          <p>WebSocket hibernation, resumable streams, SQLite persistence.</p>
        </div>
        <div className="message-list" aria-live="polite">
          {messages.map((message) => (
            <div className="message-row" data-role={message.role} key={message.id}>
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
          <button className="button button-primary" type="submit" disabled={isSending}>
            <Send size={16} aria-hidden="true" />
            {isSending ? "Sending" : "Send"}
          </button>
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
