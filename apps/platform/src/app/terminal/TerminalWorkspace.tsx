"use client";

import { KeyRound, Monitor, Play, Server, TerminalSquare } from "lucide-react";
import { useTerminal } from "@open-think/ui";

const accessRows = [
  { label: "Container", value: "Firecracker isolated microVM", Icon: Server },
  { label: "Browser", value: "Cloudflare Access protected PTY", Icon: Monitor },
  { label: "Local", value: "TCP-over-TLS through cloudflared", Icon: KeyRound },
  {
    label: "Sidecar",
    value: "Durable Object starts, stops, and monitors runtime",
    Icon: TerminalSquare
  }
] as const;

export function TerminalWorkspace() {
  const { lines, command, setCommand, run, isRunning, error } = useTerminal();

  return (
    <section className="workspace-page" aria-label="Terminal workspace">
      <div className="surface terminal-shell">
        <div className="surface-header">
          <div className="page-kicker">TerminalDO</div>
          <h1>Browser terminal</h1>
          <p>PTY keystrokes and resize events multiplexed over one WebSocket.</p>
        </div>
        <div className="terminal-output" aria-live="polite">
          {lines.map((line) => (
            <div key={line.id}>{line.content}</div>
          ))}
          {error ? <div>{error}</div> : null}
        </div>
        <form
          className="terminal-command"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            void run(String(formData.get("command") ?? ""));
          }}
        >
          <input
            aria-label="Terminal command"
            name="command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
          <button className="button button-primary" type="submit" disabled={isRunning}>
            <Play size={16} aria-hidden="true" />
            {isRunning ? "Running" : "Run"}
          </button>
        </form>
      </div>

      <aside className="surface">
        <div className="surface-header">
          <div className="page-kicker">Access</div>
          <h2>Web and local shells</h2>
          <p>Browser PTY for instant control, cloudflared for native SSH workflows.</p>
        </div>
        <div className="surface-body">
          {accessRows.map(({ label, value, Icon }) => (
            <div className="terminal-row" key={label}>
              <Icon size={17} color="var(--accent-strong)" aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <br />
                <span className="field-hint">{value}</span>
              </span>
            </div>
          ))}
          <div className="code-box">
            cloudflared access ssh --hostname personal-agent.beta2.open-think.app
          </div>
        </div>
      </aside>
    </section>
  );
}
