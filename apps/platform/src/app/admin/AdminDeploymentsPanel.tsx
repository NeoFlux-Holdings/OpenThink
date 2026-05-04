"use client";

import { Database, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuthenticatedUser } from "@/lib/auth";
import type { DeploymentRecord } from "@/lib/d1";
import type { RepositoryKind } from "@/lib/environment";

interface AdminDeploymentsResponse {
  user: AuthenticatedUser;
  repository: RepositoryKind;
  deployments: DeploymentRecord[];
}

export function AdminDeploymentsPanel() {
  const [payload, setPayload] = useState<AdminDeploymentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadDeployments() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/deployments", {
        headers: { Accept: "application/json" }
      });
      const body = (await response.json().catch(() => null)) as
        | AdminDeploymentsResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          body && "error" in body && body.error
            ? body.error
            : "Admin deployment list failed."
        );
      }

      setPayload(body as AdminDeploymentsResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Admin deployment list failed.");
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDeployments();
  }, []);

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <div>
          <span className="eyebrow">
            {payload?.repository === "d1" ? "Live D1 data" : "Local memory data"}
          </span>
          <strong>{payload?.deployments.length ?? 0} launches</strong>
          <small>
            {payload?.user.email ?? payload?.user.id ?? "Admin identity required"}
          </small>
        </div>
        <button className="button" type="button" onClick={loadDeployments} disabled={isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="notice admin-state">
          <ShieldAlert size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {!error && isLoading ? (
        <div className="admin-state">
          <Database size={18} aria-hidden="true" />
          <span>Loading deployment records from the platform D1 binding.</span>
        </div>
      ) : null}

      {!error && !isLoading && payload?.deployments.length === 0 ? (
        <div className="admin-state">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>No self-service deployments have been recorded yet.</span>
        </div>
      ) : null}

      {payload?.deployments.length ? (
        <div className="admin-list" aria-label="Recent self-service deployments">
          {payload.deployments.map((deployment) => (
            <article className="admin-deployment" key={deployment.id}>
              <div className="admin-deployment-main">
                <span className="status-pill" data-status={deployment.status}>
                  {deployment.status}
                </span>
                <div>
                  <h2>{deployment.authorization?.agentName ?? deployment.id}</h2>
                  <p>{deployment.agentUrl}</p>
                </div>
              </div>
              <dl className="admin-metadata">
                <div>
                  <dt>Account</dt>
                  <dd>{deployment.authorization?.accountId ?? "not recorded"}</dd>
                </div>
                <div>
                  <dt>Token</dt>
                  <dd>{deployment.authorization?.tokenFingerprint ?? "not recorded"}</dd>
                </div>
                <div>
                  <dt>Limit</dt>
                  <dd>
                    {deployment.authorization
                      ? `$${deployment.authorization.spendLimitUsd}`
                      : "not recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(deployment.createdAt)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
