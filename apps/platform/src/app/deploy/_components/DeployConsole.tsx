"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RotateCcw, ShieldCheck } from "lucide-react";
import { deploymentFlows } from "@/lib/platform";
import type {
  AutomationSnapshot,
  DeploymentEvent,
  DeploymentFlow,
  DeploymentStatus,
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
          | { deploymentId?: string; error?: string }
          | null;
        if (body?.deploymentId) setDeploymentId(body.deploymentId);
        throw new Error(body?.error ?? "Deployment stream failed.");
      }

      const responseDeploymentId = response.headers.get("X-Deployment-Id");
      let receivedEvents: DeploymentEvent[] = [];
      setDeploymentId(responseDeploymentId);
      setAgentUrl(response.headers.get("X-Agent-Url"));
      await readSse(response.body, (event) => {
        receivedEvents = mergeDeploymentEvent(receivedEvents, event);
        setEvents(receivedEvents);
        if (event.agentUrl) setAgentUrl(event.agentUrl);
        if (event.automation) setAutomation(event.automation);
        if (event.resources) setResources(event.resources);
      });

      if (responseDeploymentId && !hasTerminalDeploymentEvent(receivedEvents)) {
        await pollDeploymentStatus(responseDeploymentId, {
          onStatus(payload) {
            if (payload.agentUrl) setAgentUrl(payload.agentUrl);
            const resourcesFromPlan = resourcePlanToResources(payload.resourcePlan);
            if (resourcesFromPlan.length > 0) setResources(resourcesFromPlan);
          },
          onEvent(event) {
            receivedEvents = mergeDeploymentEvent(receivedEvents, event);
            setEvents(receivedEvents);
            if (event.agentUrl) setAgentUrl(event.agentUrl);
            if (event.automation) setAutomation(event.automation);
            if (event.resources) setResources(event.resources);
          }
        });
      }
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

interface DeploymentStatusPayload {
  deploymentId: string;
  status: DeploymentStatus;
  agentUrl: string;
  events: DeploymentEvent[];
  resourcePlan?: Record<string, unknown>;
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

async function pollDeploymentStatus(
  deploymentId: string,
  handlers: {
    onStatus(payload: DeploymentStatusPayload): void;
    onEvent(event: DeploymentEvent): void;
  }
) {
  const maxAttempts = 300;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`/api/deployment/status/${encodeURIComponent(deploymentId)}`, {
      cache: "no-store"
    });

    if (response.ok) {
      const payload = (await response.json()) as DeploymentStatusPayload;
      handlers.onStatus(payload);
      for (const event of payload.events ?? []) {
        handlers.onEvent(event);
      }
      if (payload.status === "ready" || payload.status === "failed") {
        return;
      }
    }

    await delay(2000);
  }

  throw new Error("Deployment is still running. Refresh deployment status to continue tracking it.");
}

function mergeDeploymentEvent(
  events: DeploymentEvent[],
  event: DeploymentEvent
): DeploymentEvent[] {
  const existingIndex = events.findIndex((item) => item.id === event.id);
  if (existingIndex === -1) return [...events, event];
  const next = [...events];
  next[existingIndex] = event;
  return next;
}

function hasTerminalDeploymentEvent(events: DeploymentEvent[]): boolean {
  return events.some((event) => event.id === "ready" || event.status === "error");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resourcePlanToResources(plan: Record<string, unknown> | undefined): DeploymentResource[] {
  if (!plan) return [];
  const scriptName = textField(plan, "scriptName");
  const workerDeployment = recordField(plan, "workerDeployment");
  const d1Database = recordField(plan, "d1Database");
  const r2Bucket = recordField(plan, "r2Bucket");
  const vectorizeIndex = recordField(plan, "vectorizeIndex");
  const queue = recordField(plan, "queue");
  const resources: DeploymentResource[] = [];

  if (scriptName) resources.push({ type: "Worker", name: scriptName });
  const accessApplicationId = textField(workerDeployment, "accessApplicationId");
  if (accessApplicationId) {
    resources.push({
      type: "Access",
      name: accessApplicationId,
      binding: "Cloudflare Access"
    });
  }
  const d1Name = textField(d1Database, "name");
  if (d1Name) resources.push({ type: "D1", name: d1Name, binding: "DB" });
  const r2Name = textField(r2Bucket, "name");
  if (r2Name) resources.push({ type: "R2", name: r2Name, binding: "AGENT_STORAGE" });
  const vectorizeName = textField(vectorizeIndex, "name");
  if (vectorizeName) {
    resources.push({ type: "Vectorize", name: vectorizeName, binding: "VECTORIZE" });
  }
  const queueName = textField(queue, "name");
  if (queueName) resources.push({ type: "Queue", name: queueName, binding: "TASK_QUEUE" });

  return resources;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
