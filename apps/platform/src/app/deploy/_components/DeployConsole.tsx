"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RotateCcw, ShieldCheck } from "lucide-react";
import { deploymentFlows } from "@/lib/platform";
import type {
  AutomationSnapshot,
  DeploymentEvent,
  DeploymentFlow,
  DeploymentRequest,
  DeploymentResource
} from "@/lib/deployment-engine";
import { DeploymentTimeline } from "./DeploymentTimeline";
import { FlowSelector } from "./FlowSelector";
import { SelfDeployFlow } from "./SelfDeployFlow";

export function DeployConsole() {
  const [flow, setFlow] = useState<DeploymentFlow>("self");
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentUrl, setAgentUrl] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [automation, setAutomation] = useState<AutomationSnapshot | null>(null);
  const [resources, setResources] = useState<DeploymentResource[]>([]);

  const selectedFlow = useMemo(
    () => deploymentFlows.find((item) => item.id === flow) ?? deploymentFlows[0],
    [flow]
  );

  const progress = events.at(-1)?.progress ?? 0;

  useEffect(() => {
    let ignore = false;

    async function loadEnvironment() {
      const response = await fetch("/api/deployment/environment");
      if (!response.ok) return;
      const payload = (await response.json()) as { automation?: AutomationSnapshot };
      if (!ignore && payload.automation) setAutomation(payload.automation);
    }

    void loadEnvironment();

    return () => {
      ignore = true;
    };
  }, []);

  async function startDeployment(payload: Partial<DeploymentRequest>) {
    setError(null);
    setEvents([]);
    setAgentUrl(null);
    setDeploymentId(null);
    setResources([]);
    setIsDeploying(true);

    try {
      const response = await fetch(`/api/deployment/${flow}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          starterTemplate: "personal-agent"
        })
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Deployment stream failed.");
      }

      setDeploymentId(response.headers.get("X-Deployment-Id"));
      setAgentUrl(response.headers.get("X-Agent-Url"));
      await readSse(response.body, (event) => {
        setEvents((current) => [...current, event]);
        if (event.automation) setAutomation(event.automation);
        if (event.resources) setResources(event.resources);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Deployment failed.");
    } finally {
      setIsDeploying(false);
    }
  }

  return (
    <section className="deploy-console" id="deploy-console" aria-label="Deployment console">
      <div className="surface">
        <div className="surface-header">
          <div className="page-kicker">Launch model</div>
          <h2>Deploy into your Cloudflare account</h2>
          <p>{selectedFlow?.operator}</p>
        </div>
        <div className="surface-body">
          <FlowSelector value={flow} onChange={setFlow} />
          <div className="policy-box">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>
              Public users deploy with their own Cloudflare credentials. Platform owner credentials
              are not used for self-service agents.
            </span>
          </div>
        </div>
      </div>

      <div className="deployment-workbench">
        <div className="surface">
          <div className="surface-header">
            <div className="page-kicker">{selectedFlow?.eyebrow}</div>
            <h2>{selectedFlow?.label}</h2>
            <p>{selectedFlow?.summary}</p>
          </div>
          <div className="surface-body">
            {flow === "self" ? (
              <SelfDeployFlow isDeploying={isDeploying} onDeploy={startDeployment} />
            ) : (
              <FuturePathway flow={flow} onUseSelf={() => setFlow("self")} />
            )}
          </div>
        </div>

        <div className="surface">
          <div className="surface-header">
            <div className="page-kicker">SSE progress</div>
            <h2>Deployment state</h2>
            <p>{deploymentId ?? "No deployment running"}</p>
          </div>
          <div className="surface-body">
            <div className="progress-track" aria-label="Deployment progress">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            {error ? <p className="notice">{error}</p> : null}
            <AutomationStatusPanel automation={automation} />
            {agentUrl ? (
              <p className="success-box">
                Ready surface:{" "}
                <a href={agentUrl} target="_blank" rel="noreferrer">
                  {agentUrl}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </p>
            ) : null}
            <ResourcePlanPanel resources={resources} />
            <DeploymentTimeline events={events} isDeploying={isDeploying} />
          </div>
          <div className="surface-footer">
            <button
              className="button button-block"
              type="button"
              disabled={isDeploying || events.length === 0}
              onClick={() => {
                setEvents([]);
                setAgentUrl(null);
                setDeploymentId(null);
                setError(null);
                setResources([]);
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Reset state
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FuturePathway({
  flow,
  onUseSelf
}: {
  flow: DeploymentFlow;
  onUseSelf: () => void;
}) {
  const label = deploymentFlows.find((item) => item.id === flow)?.label ?? "This pathway";

  return (
    <div className="future-pathway">
      <h3>{label} is reserved for managed onboarding</h3>
      <p>
        The public launch path is user-owned Cloudflare deployment first. OAuth, Stripe Projects,
        and partner account creation can attach later without changing the agent template.
      </p>
      <button className="button button-primary" type="button" onClick={onUseSelf}>
        Use self-service launch
      </button>
    </div>
  );
}

function AutomationStatusPanel({
  automation
}: {
  automation: AutomationSnapshot | null;
}) {
  const cells = [
    ["Mode", automation?.deploymentMode ?? "loading"],
    ["Provisioner", automation?.provisioner ?? "loading"],
    ["State store", automation?.repository ?? "loading"],
    ["Models", automation?.aiProvider ?? "loading"]
  ];

  return (
    <div className="automation-panel" aria-label="Automation status">
      {cells.map(([label, value]) => (
        <div className="automation-cell" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      {automation?.missing.length ? (
        <p className="notice">
          Missing for live Cloudflare mode: {automation.missing.join(", ")}
        </p>
      ) : null}
      {automation?.warnings.map((warning) => (
        <p className="automation-note" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}

function ResourcePlanPanel({ resources }: { resources: DeploymentResource[] }) {
  if (resources.length === 0) {
    return (
      <div className="resource-plan" aria-label="Planned Cloudflare resources">
        <span className="resource-empty">Resource names appear after planning.</span>
      </div>
    );
  }

  return (
    <div className="resource-plan" aria-label="Planned Cloudflare resources">
      {resources.map((resource) => (
        <div className="resource-row" key={`${resource.type}:${resource.name}`}>
          <span>
            <strong>{resource.type}</strong>
            {resource.binding ? <small>{resource.binding}</small> : null}
          </span>
          <code>{resource.name}</code>
        </div>
      ))}
    </div>
  );
}

async function readSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: DeploymentEvent) => void
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const eventLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (!eventLine) continue;

      const parsed = JSON.parse(eventLine.slice(6)) as DeploymentEvent | { ok: true };
      if ("id" in parsed) onEvent(parsed);
    }
  }
}
