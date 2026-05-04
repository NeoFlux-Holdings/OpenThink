import { ArrowRight, ShieldCheck, TerminalSquare } from "lucide-react";
import { DeployConsole } from "./_components/DeployConsole";

export default function DeployPage() {
  return (
    <>
      <section className="deploy-hero" aria-labelledby="deploy-title">
        <div className="hero-copy">
          <div className="page-kicker">Cloudflare-native agent OS</div>
          <h1 id="deploy-title" className="page-title">
            Launch your own personal agent on Cloudflare.
          </h1>
          <p className="page-summary">
            `open-think` gives each user one all-in-one agent for coding, chat,
            messaging tools, memory, files, tasks, and terminal handoff. The
            agent is deployed into the user's Cloudflare account, not the
            platform owner's account.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#deploy-console">
              Start deployment
              <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a className="button" href="/terminal">
              Terminal surface
              <TerminalSquare size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
        <aside className="control-panel" aria-label="Platform architecture summary">
          <div className="control-panel-header">
            <div>
              <h2>Three-layer runtime</h2>
              <p>Worker routing, Durable Object coordination, Container execution.</p>
            </div>
            <ShieldCheck color="var(--green)" size={24} aria-hidden="true" />
          </div>
          <div className="stat-grid">
            <div className="stat-cell">
              <strong>4</strong>
              <span>Managed pathways later</span>
            </div>
            <div className="stat-cell">
              <strong>1</strong>
              <span>Personal agent template</span>
            </div>
            <div className="stat-cell">
              <strong>3</strong>
              <span>Runtime layers</span>
            </div>
            <div className="stat-cell">
              <strong>10m</strong>
              <span>Default container keepAlive</span>
            </div>
          </div>
        </aside>
      </section>
      <DeployConsole />
    </>
  );
}
