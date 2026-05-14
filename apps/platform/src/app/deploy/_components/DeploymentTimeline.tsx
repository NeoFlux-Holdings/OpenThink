"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import type { DeploymentEvent } from "@/lib/deployment-engine";

interface DeploymentTimelineProps {
  events: DeploymentEvent[];
  isDeploying: boolean;
}

export function DeploymentTimeline({ events, isDeploying }: DeploymentTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="timeline" aria-live="polite">
        <div className="timeline-row">
          <span className="timeline-marker">
            <CircleDashed size={15} aria-hidden="true" />
          </span>
          <span className="timeline-copy">
            <strong>{isDeploying ? "Waiting for stream" : "Deployment idle"}</strong>
            <small>SSE events will appear as the route emits provisioning stages.</small>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline" aria-live="polite">
      {events.map((event) => (
        <div className="timeline-row" data-state={event.status} key={event.id}>
          <span className="timeline-marker">
            {event.status === "error" ? (
              <AlertTriangle size={15} aria-hidden="true" />
            ) : event.status === "active" ? (
              <Loader2 size={15} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={15} aria-hidden="true" />
            )}
          </span>
          <span className="timeline-copy">
            <strong>{event.label}</strong>
            <small>{event.progress}% - {event.detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
