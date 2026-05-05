"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Cloud,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  KeyRound,
  ListRestart,
  RefreshCw,
  Rocket,
  Settings2,
  ShieldCheck
} from "lucide-react";
import type { AutoSyncConfig, SyncAction, SyncResult, SyncStatus } from "@open-think/sync";
import type {
  DeploymentUpdateAction,
  DeploymentUpdateSummary
} from "@/lib/deployment-update";

const manualActions: Array<{
  action: SyncAction;
  label: string;
  icon: typeof GitBranch;
}> = [
  { action: "pull", label: "Pull Remote", icon: GitPullRequestArrow },
  { action: "commit", label: "Commit Draft", icon: GitCommitHorizontal },
  { action: "push", label: "Push Artifact", icon: Cloud },
  { action: "deploy", label: "Deploy Artifact", icon: Rocket },
  { action: "reconcile", label: "Reconcile", icon: RefreshCw }
];

const UPDATE_TOKEN_STORAGE_KEY = "open-think.cf-api-token";

type TokenStatus =
  | { state: "empty"; message: string }
  | { state: "saved"; message: string }
  | { state: "checking"; message: string }
  | { state: "verified"; message: string }
  | { state: "warning"; message: string }
  | { state: "error"; message: string };

type TokenVerificationPayload = {
  inspection?: {
    userEmail?: string;
    accounts?: Array<{ id: string; name?: string }>;
    defaultAccountId?: string;
    defaultAccessEmail?: string;
  };
  permissionIssue?: {
    error: string;
    cloudflare?: {
      requiredPermission?: string;
    };
  };
  error?: string;
};

export function SyncWorkspace() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [deploymentUpdates, setDeploymentUpdates] = useState<DeploymentUpdateSummary[]>([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState("");
  const [updateToken, setUpdateToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>({
    state: "empty",
    message: "Paste a Cloudflare API token to unlock updates for deployed agents."
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState<SyncAction | "auto" | null>(null);
  const [isDeploymentWorking, setIsDeploymentWorking] = useState<
    DeploymentUpdateAction | "auto" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  const headline = useMemo(() => {
    if (!status) return "Loading sync state";
    if (status.sourceOfTruth === "cloudflare-artifacts") {
      return "Cloudflare Artifacts is canonical";
    }
    return "Local dev memory sync is active";
  }, [status]);

  const selectedDeployment = useMemo(
    () =>
      deploymentUpdates.find((deployment) => deployment.deploymentId === selectedDeploymentId) ??
      deploymentUpdates[0] ??
      null,
    [deploymentUpdates, selectedDeploymentId]
  );

  const selectedAutoUpdate = selectedDeployment?.metadata?.autoUpdate ?? {
    enabled: false,
    direction: "bidirectional" as const,
    intervalSeconds: 300
  };

  useEffect(() => {
    void refresh();
    const savedToken = readStoredUpdateToken();
    if (savedToken) {
      setUpdateToken(savedToken);
      setTokenStatus({
        state: "saved",
        message: "Token loaded from this browser. Verifying it now..."
      });
    } else {
      void loadDeploymentUpdates();
    }
  }, []);

  useEffect(() => {
    const token = updateToken.trim();
    if (!token) {
      storeUpdateToken("");
      setTokenStatus({
        state: "empty",
        message: "Paste a Cloudflare API token to unlock updates for deployed agents."
      });
      return;
    }

    storeUpdateToken(token);
    setTokenStatus((current) =>
      current.state === "verified" || current.state === "warning"
        ? {
            state: "saved",
            message: "Token changed and saved locally. Verify it before updating a Worker."
          }
        : current
    );

    const timeout = window.setTimeout(() => {
      if (token.length >= 20) {
        void verifyUpdateToken(token, { refreshTarget: true, silent: true });
      }
    }, 850);

    return () => window.clearTimeout(timeout);
  }, [updateToken]);

  async function refresh() {
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/sync/status");
      if (!response.ok) throw new Error("Sync status failed.");
      const payload = (await response.json()) as { status: SyncStatus };
      setStatus(payload.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync status failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function runManual(action: SyncAction) {
    setError(null);
    setIsWorking(action);
    try {
      const response = await fetch("/api/sync/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          message: "Update open-think artifact"
        })
      });
      const payload = (await response.json()) as {
        result?: SyncResult;
        error?: string;
      };
      if (!response.ok || !payload.result) {
        throw new Error(payload.error ?? "Sync action failed.");
      }
      setResult(payload.result);
      setStatus(payload.result.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync action failed.");
    } finally {
      setIsWorking(null);
    }
  }

  async function updateAuto(config: Partial<AutoSyncConfig>) {
    setError(null);
    setIsWorking("auto");
    try {
      const response = await fetch("/api/sync/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      const payload = (await response.json()) as {
        status?: SyncStatus;
        error?: string;
      };
      if (!response.ok || !payload.status) {
        throw new Error(payload.error ?? "Auto sync update failed.");
      }
      setStatus(payload.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Auto sync update failed.");
    } finally {
      setIsWorking(null);
    }
  }

  async function loadDeploymentUpdates(token = updateToken): Promise<number | null> {
    setDeploymentError(null);
    try {
      const headers: HeadersInit = {};
      const trimmedToken = token.trim();
      if (trimmedToken) headers["x-open-think-cf-api-token"] = trimmedToken;
      const response = await fetch("/api/deployment/update", { headers });
      const payload = (await response.json()) as {
        deployments?: DeploymentUpdateSummary[];
        error?: string;
      };
      if (!response.ok || !payload.deployments) {
        throw new Error(payload.error ?? "Deployment update status failed.");
      }
      setDeploymentUpdates(payload.deployments);
      setSelectedDeploymentId((current) => current || payload.deployments?.[0]?.deploymentId || "");
      return payload.deployments.length;
    } catch (caught) {
      setDeploymentError(
        caught instanceof Error ? caught.message : "Deployment update status failed."
      );
      return null;
    }
  }

  async function verifyUpdateToken(
    token = updateToken,
    options: { refreshTarget?: boolean; silent?: boolean } = {}
  ) {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setTokenStatus({
        state: "error",
        message: "Paste a Cloudflare API token first."
      });
      return;
    }

    if (!options.silent) setDeploymentError(null);
    setTokenStatus({
      state: "checking",
      message: "Verifying token with Cloudflare..."
    });

    try {
      const response = await fetch("/api/deployment/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cfApiToken: trimmedToken })
      });
      const payload = (await response.json()) as TokenVerificationPayload;
      if (!response.ok || !payload.inspection) {
        throw new Error(payload.error ?? "Token verification failed.");
      }

      storeUpdateToken(trimmedToken);
      const account =
        payload.inspection.accounts?.find(
          (item) => item.id === payload.inspection?.defaultAccountId
        ) ?? payload.inspection.accounts?.[0];
      const accountLabel = account
        ? `${account.name ?? "Cloudflare account"} (${maskCloudflareId(account.id)})`
        : "Cloudflare account";
      const email = payload.inspection.defaultAccessEmail ?? payload.inspection.userEmail;

      const refreshedCount = options.refreshTarget ? await loadDeploymentUpdates(trimmedToken) : null;
      const refreshMessage =
        refreshedCount === null
          ? "Token verified; target refresh needs attention."
          : refreshedCount > 0
            ? `Target refreshed: ${refreshedCount} deployment${refreshedCount === 1 ? "" : "s"} available.`
            : "Target refreshed, but no OpenThink deployments were found in this Cloudflare account.";

      if (payload.permissionIssue) {
        setTokenStatus({
          state: "warning",
          message: `${accountLabel} verified${
            email ? ` for ${email}` : ""
          }, but this token is missing ${
            payload.permissionIssue.cloudflare?.requiredPermission ?? "a required permission"
          }. ${refreshMessage}`
        });
      } else {
        setTokenStatus({
          state: "verified",
          message: `${accountLabel} verified${email ? ` for ${email}` : ""}. ${refreshMessage}`
        });
      }
    } catch (caught) {
      setTokenStatus({
        state: "error",
        message: caught instanceof Error ? caught.message : "Token verification failed."
      });
    }
  }

  function handleUpdateTokenChange(value: string) {
    setDeploymentError(null);
    setUpdateToken(value);
  }

  function clearUpdateToken() {
    setUpdateToken("");
    storeUpdateToken("");
    setTokenStatus({
      state: "empty",
      message: "Paste a Cloudflare API token to unlock updates for deployed agents."
    });
  }

  async function runDeploymentUpdate(
    action: DeploymentUpdateAction,
    autoUpdate?: Partial<AutoSyncConfig>
  ) {
    if (!selectedDeployment) return;
    if (!selectedDeployment.canUpdateWithoutToken && !updateToken.trim()) {
      setDeploymentError(
        "Paste and verify a Cloudflare API token first. This platform only stores a fingerprint after launch."
      );
      return;
    }

    setDeploymentError(null);
    setIsDeploymentWorking(action);
    try {
      const response = await fetch("/api/deployment/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deploymentId: selectedDeployment.deploymentId,
          action,
          ...(updateToken.trim() ? { cfApiToken: updateToken.trim() } : {}),
          ...(autoUpdate ? { autoUpdate } : {})
        })
      });
      const payload = (await response.json()) as {
        deployment?: DeploymentUpdateSummary;
        status?: SyncStatus;
        result?: SyncResult;
        error?: string;
      };
      if (!response.ok || !payload.deployment || !payload.status) {
        throw new Error(payload.error ?? "Deployment update failed.");
      }
      setStatus(payload.status);
      if (payload.result) setResult(payload.result);
      setDeploymentUpdates((deployments) =>
        deployments.map((deployment) =>
          deployment.deploymentId === payload.deployment?.deploymentId
            ? payload.deployment
            : deployment
        )
      );
    } catch (caught) {
      setDeploymentError(caught instanceof Error ? caught.message : "Deployment update failed.");
    } finally {
      setIsDeploymentWorking(null);
    }
  }

  return (
    <section className="workspace-page" aria-label="Repository sync workspace">
      <div className="sync-main-column">
        <div className="surface sync-shell">
          <div className="surface-header">
            <div className="page-kicker">Artifacts Git</div>
            <h1>{headline}</h1>
            <p>
              Worker-side changes commit to Cloudflare Artifacts; local changes pull
              from the same remote so manual and automatic sync use one path.
            </p>
          </div>
          <div className="surface-body">
            {error ? <p className="notice">{error}</p> : null}
            <div className="sync-status-grid" aria-busy={isLoading}>
              <SyncMetric label="Source" value={status?.sourceOfTruth ?? "loading"} />
              <SyncMetric label="Branch" value={status?.branch ?? "loading"} />
              <SyncMetric label="Drift" value={status?.drift ?? "loading"} />
              <SyncMetric
                label="Auto Sync"
                value={status?.autoSync.enabled ? "enabled" : "disabled"}
              />
            </div>
            <div className="resource-plan">
              {[
                ["Local head", status?.localHead],
                ["Remote head", status?.remoteHead],
                ["Deployed head", status?.deployedHead],
                ["Remote", status?.remoteUrl]
              ].map(([label, value]) => (
                <div className="resource-row" key={label}>
                  <span>
                    <strong>{label}</strong>
                  </span>
                  <code>{value ?? "not set"}</code>
                </div>
              ))}
            </div>
            {status?.missing.length ? (
              <p className="notice">Missing: {status.missing.join(", ")}</p>
            ) : null}
            {status?.warnings.length ? (
              <p className="automation-note">{status.warnings[0]}</p>
            ) : null}
            {result ? (
              <p className="success-box">
                {result.message}
                {result.commitSha ? <code> {result.commitSha}</code> : null}
              </p>
            ) : null}
          </div>
          <div className="surface-footer sync-action-grid">
            {manualActions.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className="button"
                  disabled={isWorking !== null}
                  key={item.action}
                  type="button"
                  onClick={() => void runManual(item.action)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {isWorking === item.action ? "Working" : item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="surface">
          <div className="surface-header">
            <div className="page-kicker">Deployed Agent</div>
            <h2>Update target</h2>
            <p>Manual and cron updates reuse the stored resource plan for the selected launch.</p>
          </div>
          <div className="surface-body">
            {deploymentError ? <p className="notice">{deploymentError}</p> : null}
            <div className="form-grid">
              <div className="field token-first-field">
                <label htmlFor="deployment-update-token">Cloudflare API token</label>
                <div className="inline-control token-control">
                  <input
                    id="deployment-update-token"
                    type="password"
                    value={updateToken}
                    placeholder={
                      selectedDeployment?.canUpdateWithoutToken
                        ? "Configured token available"
                        : "Paste token to update deployed agents"
                    }
                    onChange={(event) => handleUpdateTokenChange(event.target.value)}
                    onBlur={() =>
                      updateToken.trim()
                        ? void verifyUpdateToken(updateToken, { refreshTarget: true })
                        : undefined
                    }
                  />
                  <button
                    className="button"
                    type="button"
                    disabled={!updateToken.trim() || tokenStatus.state === "checking"}
                    onClick={() => void verifyUpdateToken(updateToken, { refreshTarget: true })}
                  >
                    <ShieldCheck size={16} aria-hidden="true" />
                    {tokenStatus.state === "checking" ? "Checking" : "Verify"}
                  </button>
                </div>
                <span className="field-hint">
                  {selectedDeployment?.canUpdateWithoutToken
                    ? `Using ${selectedDeployment.credentialSource}. You can still paste a token to override it for this update.`
                    : "Stored only in this browser for update actions; raw user tokens are not stored by the platform after launch."}
                </span>
                <div className="token-status" data-state={tokenStatus.state}>
                  <span>{tokenStatus.message}</span>
                  {updateToken.trim() ? (
                    <button type="button" onClick={clearUpdateToken}>
                      Clear saved token
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="field">
                <label htmlFor="deployment-update-target">Deployment</label>
                <select
                  id="deployment-update-target"
                  value={selectedDeployment?.deploymentId ?? ""}
                  onChange={(event) => setSelectedDeploymentId(event.target.value)}
                >
                  {deploymentUpdates.length ? (
                    deploymentUpdates.map((deployment) => (
                      <option value={deployment.deploymentId} key={deployment.deploymentId}>
                        {deployment.agentName} · {deployment.deploymentId}
                      </option>
                    ))
                  ) : (
                    <option value="">No deployments</option>
                  )}
                </select>
              </div>
            </div>
            <div className="resource-plan">
              {[
                ["Script", selectedDeployment?.target?.scriptName],
                ["Account", selectedDeployment?.target?.accountId],
                ["Agent URL", selectedDeployment?.agentUrl],
                ["Auto updates", selectedAutoUpdate.enabled ? "enabled" : "disabled"]
              ].map(([label, value]) => (
                <div className="resource-row" key={label}>
                  <span>
                    <strong>{label}</strong>
                  </span>
                  <code>{value ?? "not set"}</code>
                </div>
              ))}
            </div>
            {selectedDeployment?.warnings.length ? (
              <p className="automation-note">{selectedDeployment.warnings[0]}</p>
            ) : null}
            {selectedDeployment?.metadata?.lastError ? (
              <p className="notice">{selectedDeployment.metadata.lastError}</p>
            ) : null}
          </div>
          <div className="surface-footer sync-action-grid">
            <button
              className="button"
              type="button"
              disabled={!selectedDeployment || isDeploymentWorking !== null}
              onClick={() => void runDeploymentUpdate("pull")}
            >
              <GitPullRequestArrow size={16} aria-hidden="true" />
              {isDeploymentWorking === "pull" ? "Working" : "Pull Remote"}
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={!selectedDeployment || isDeploymentWorking !== null}
              onClick={() => void runDeploymentUpdate("deploy")}
            >
              <Rocket size={16} aria-hidden="true" />
              {isDeploymentWorking === "deploy" ? "Working" : "Update Worker"}
            </button>
            <button
              className="button"
              type="button"
              disabled={!selectedDeployment || isDeploymentWorking !== null}
              onClick={() => void runDeploymentUpdate("reconcile")}
            >
              <ListRestart size={16} aria-hidden="true" />
              {isDeploymentWorking === "reconcile" ? "Working" : "Reconcile"}
            </button>
            <button
              className="button"
              type="button"
              disabled={!selectedDeployment || isDeploymentWorking !== null}
              onClick={() =>
                void runDeploymentUpdate("status", {
                  ...selectedAutoUpdate,
                  enabled: !selectedAutoUpdate.enabled
                })
              }
            >
              <RefreshCw size={16} aria-hidden="true" />
              {selectedAutoUpdate.enabled ? "Disable Auto" : "Enable Auto"}
            </button>
            <button
              className="button"
              type="button"
              disabled={isDeploymentWorking !== null}
              onClick={() => void loadDeploymentUpdates()}
            >
              <KeyRound size={16} aria-hidden="true" />
              Refresh Target
            </button>
          </div>
        </div>
      </div>

      <aside className="surface">
        <div className="surface-header">
          <div className="page-kicker">Automation</div>
          <h2>Sync policy</h2>
          <p>Manual controls use the same reconciler as the Worker cron.</p>
        </div>
        <div className="surface-body">
          <div className="terminal-row">
            <Settings2 size={17} color="var(--accent-strong)" aria-hidden="true" />
            <span>
              <strong>Direction</strong>
              <br />
              <span className="field-hint">{status?.autoSync.direction ?? "bidirectional"}</span>
            </span>
          </div>
          <div className="terminal-row">
            <RefreshCw size={17} color="var(--accent-strong)" aria-hidden="true" />
            <span>
              <strong>Interval</strong>
              <br />
              <span className="field-hint">
                {status?.autoSync.intervalSeconds ?? 300} seconds
              </span>
            </span>
          </div>
          <div className="terminal-row">
            <CheckCircle2 size={17} color="var(--accent-strong)" aria-hidden="true" />
            <span>
              <strong>Dirty files</strong>
              <br />
              <span className="field-hint">
                {status?.dirtyFiles.length ? status.dirtyFiles.join(", ") : "none"}
              </span>
            </span>
          </div>
          <div className="form-grid">
            <button
              className="button button-primary"
              type="button"
              disabled={isWorking !== null}
              onClick={() =>
                void updateAuto({
                  enabled: !(status?.autoSync.enabled ?? false)
                })
              }
            >
              <RefreshCw size={16} aria-hidden="true" />
              {status?.autoSync.enabled ? "Disable Auto Sync" : "Enable Auto Sync"}
            </button>
            <button
              className="button"
              type="button"
              disabled={isWorking !== null}
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Refresh Status
            </button>
          </div>
        </div>
      </aside>
    </section>
  );
}

function SyncMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function readStoredUpdateToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(UPDATE_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeUpdateToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(UPDATE_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(UPDATE_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Browsers can block localStorage in hardened privacy modes.
  }
}

function maskCloudflareId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-6)}`;
}
