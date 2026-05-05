"use client";

import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
  WalletCards
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DeploymentRequest } from "@/lib/deployment-engine";
import {
  PersonalAgentConfigurator,
  createPersonalAgentConfiguratorState,
  personalAgentConfigFromConfiguratorState,
  personalAgentConfiguratorIssue
} from "./PersonalAgentConfigurator";
import {
  buildOpenThinkTokenUrl,
  openThinkTokenPermissions
} from "@/lib/cloudflare-token-url";

interface SelfDeployFlowProps {
  isDeploying: boolean;
  onDeploy: (payload: Partial<DeploymentRequest>) => void;
}

interface TokenInspection {
  userEmail?: string;
  defaultAccessEmail?: string;
  defaultAccountId?: string;
  accounts: Array<{ id: string; name?: string }>;
  zones: Array<{ id: string; name: string; status?: string }>;
}

interface PermissionIssue {
  error: string;
  cloudflare?: {
    status?: number;
    operation?: string;
    requiredPermission?: string;
  };
}

const launchChecks = [
  {
    label: "Token verifies",
    value: "We read the account, owner email, and zones after you paste the token.",
    Icon: KeyRound
  },
  {
    label: "Access protected",
    value: "The agent is locked to the account email by default.",
    Icon: LockKeyhole
  },
  {
    label: "Kimi default",
    value: "Kimi K2.6 on Workers AI is selected unless you choose BYOK or another provider.",
    Icon: Sparkles
  },
  {
    label: "Spend guardrail",
    value: "Self-service launch is capped at $100 until billing automation is connected.",
    Icon: WalletCards
  }
] as const;

const modelOptions = [
  {
    id: "@cf/moonshotai/kimi-k2.6",
    provider: "workers-ai",
    label: "Kimi K2.6",
    description: "Default. Cloudflare-hosted frontier coding and agent model."
  },
  {
    id: "anthropic/claude-opus-4.7",
    provider: "anthropic",
    label: "Claude Opus 4.7",
    description: "Advanced BYOK option for deep coding and planning."
  },
  {
    id: "anthropic/claude-sonnet-4.7",
    provider: "anthropic",
    label: "Claude Sonnet 4.7",
    description: "Advanced BYOK option for fast engineering work."
  },
  {
    id: "openai/gpt-5.5",
    provider: "openai",
    label: "ChatGPT 5.5",
    description: "Advanced BYOK option for broad reasoning and tool use."
  },
  {
    id: "openrouter/anthropic/claude-sonnet-4.7",
    provider: "openrouter",
    label: "OpenRouter Sonnet 4.7",
    description: "Advanced BYOK router option when you prefer one provider key."
  }
] as const;

const thinkingOptions = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" }
] as const;

export function SelfDeployFlow({ isDeploying, onDeploy }: SelfDeployFlowProps) {
  const [agentName, setAgentName] = useState("My Personal Agent");
  const [cloudflareAccountId, setCloudflareAccountId] = useState("");
  const [accessAllowedEmail, setAccessAllowedEmail] = useState("");
  const [accessAdditionalEmails, setAccessAdditionalEmails] = useState("");
  const [cfApiToken, setCfApiToken] = useState("");
  const [spendLimitUsd, setSpendLimitUsd] = useState(100);
  const [defaultModel, setDefaultModel] = useState("@cf/moonshotai/kimi-k2.6");
  const [thinkingLevel, setThinkingLevel] = useState<"low" | "medium" | "high" | "xhigh">("medium");
  const [personalAgentEnabled, setPersonalAgentEnabled] = useState(true);
  const [personalAgentConfig, setPersonalAgentConfig] = useState(() =>
    createPersonalAgentConfiguratorState()
  );
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [customDomainEnabled, setCustomDomainEnabled] = useState(false);
  const [customHostPrefix, setCustomHostPrefix] = useState("");
  const [customHostPrefixDirty, setCustomHostPrefixDirty] = useState(false);
  const [customZoneId, setCustomZoneId] = useState("");
  const [inspection, setInspection] = useState<TokenInspection | null>(null);
  const [permissionIssue, setPermissionIssue] = useState<PermissionIssue | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const tokenUrl = useMemo(
    () =>
      buildOpenThinkTokenUrl({
        accountId: cloudflareAccountId,
        tokenName: `Open Think - ${agentName}`
      }),
    [agentName, cloudflareAccountId]
  );
  const selectedModel = modelOptions.find((model) => model.id === defaultModel);
  const selectedProvider = selectedModel?.provider ?? "workers-ai";
  const personalAgentIssue =
    personalAgentEnabled
      ? personalAgentConfiguratorIssue(
          personalAgentConfig,
          "Custom .brain setup needs a stack name or a soul prompt before launch."
        )
      : null;
  const selectedZone = inspection?.zones.find((zone) => zone.id === customZoneId);
  const suggestedHostPrefix = sanitizeDomainLabel(agentName);
  const effectiveHostPrefix = customHostPrefixDirty ? customHostPrefix : suggestedHostPrefix;
  const customHostname =
    effectiveHostPrefix && selectedZone?.name ? `${effectiveHostPrefix}.${selectedZone.name}` : "";

  async function verifyToken() {
    setVerifyError(null);
    setPermissionIssue(null);
    setInspection(null);
    setIsVerifying(true);
    try {
      const response = await fetch("/api/deployment/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cfApiToken })
      });
      const body = (await response.json().catch(() => null)) as
        | { inspection?: TokenInspection; permissionIssue?: PermissionIssue; error?: string }
        | null;
      if (!response.ok || !body?.inspection) {
        throw new Error(body?.error ?? "Token verification failed.");
      }
      setInspection(body.inspection);
      setCloudflareAccountId(body.inspection.defaultAccountId ?? "");
      setAccessAllowedEmail(body.inspection.defaultAccessEmail ?? body.inspection.userEmail ?? "");
      setCustomZoneId(body.inspection.zones[0]?.id ?? "");
      setPermissionIssue(body.permissionIssue ?? null);
      if (!customHostPrefixDirty) {
        setCustomHostPrefix(sanitizeDomainLabel(agentName));
      }
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : "Token verification failed.");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <form
      className="self-launch"
      onSubmit={(event) => {
        event.preventDefault();
        const additionalEmails = accessAdditionalEmails
          .split(/[,\n]/)
          .map((email) => email.trim())
          .filter(Boolean);
        const personalAgent = personalAgentConfigFromConfiguratorState(personalAgentConfig, {
          enabled: personalAgentEnabled
        });

        const payload: Partial<DeploymentRequest> = {
          agentName,
          cloudflareAccountId,
          accessAllowedEmail,
          accessAdditionalEmails: additionalEmails,
          cfApiToken,
          spendLimitUsd,
          acceptedTerms: true,
          defaultModel,
          modelProvider: selectedProvider,
          thinkingLevel,
          providerKeys: {
            openRouterApiKey,
            anthropicApiKey,
            openAiApiKey
          },
          personalAgent
        };
        if (customDomainEnabled) {
          payload.customDomain = {
            enabled: true,
            hostname: customHostname,
            zoneId: customZoneId
          };
        }
        onDeploy(payload);
      }}
    >
      <div className="launch-grid" aria-label="Self-service launch requirements">
        {launchChecks.map(({ label, value, Icon }) => (
          <div className="launch-check" key={label}>
            <Icon size={18} color="var(--accent-strong)" aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{value}</small>
            </span>
          </div>
        ))}
      </div>

      <div className="credential-guidance">
        <strong>Credential automation</strong>
        <p>
          Create a scoped token, paste it here, then verify. Verification fills account and Access
          email defaults before launch.
        </p>
        <p className="credential-warning">
          Confirm Cloudflare shows <strong>Account - Workers R2 Storage - Edit</strong> and, for
          custom domains, <strong>Zone - DNS - Edit</strong> plus{" "}
          <strong>Zone - Workers Routes - Edit</strong>.
        </p>
        <a className="button button-small" href={tokenUrl} target="_blank" rel="noreferrer">
          Create scoped token
          <ExternalLink size={13} aria-hidden="true" />
        </a>
        <details className="permission-details">
          <summary>Included permissions</summary>
          <ul>
            {openThinkTokenPermissions.map((permission) => (
              <li key={`${permission.key}:${permission.type}`}>
                <strong>{permission.label}</strong>
                <span>{permission.reason}</span>
                {permission.manualVerification ? <em>{permission.manualVerification}</em> : null}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="field">
        <label htmlFor="agent-name">Agent name</label>
        <input
          id="agent-name"
          value={agentName}
          onChange={(event) => {
            setAgentName(event.target.value);
            if (!customHostPrefixDirty) {
              setCustomHostPrefix(sanitizeDomainLabel(event.target.value));
            }
          }}
          required
        />
        <span className="field-hint">
          This is also used for the Worker name, for example <code>open-think-tomtom-7eazhw</code>.
        </span>
      </div>

      <div className="field">
        <label htmlFor="cf-api-token">Scoped Cloudflare API token</label>
        <div className="inline-control">
          <input
            id="cf-api-token"
            type="password"
            value={cfApiToken}
            onChange={(event) => setCfApiToken(event.target.value)}
            autoComplete="off"
            required
          />
          <button
            className="button"
            type="button"
            disabled={!cfApiToken || isVerifying}
            onClick={verifyToken}
          >
            {isVerifying ? "Verifying" : "Verify"}
          </button>
        </div>
        <span className="field-hint">
          Used for provisioning and stored as a secret on the user-owned Worker for Cloudflare MCP/API operations.
        </span>
      </div>

      {verifyError ? <p className="notice">{verifyError}</p> : null}
      {permissionIssue ? (
        <p className="notice">
          {permissionIssue.error}
          {permissionIssue.cloudflare?.requiredPermission
            ? ` Add ${permissionIssue.cloudflare.requiredPermission} to the scoped token before launching.`
            : null}
        </p>
      ) : null}
      {inspection ? (
        <div className="verified-panel">
          <CheckCircle2 size={17} aria-hidden="true" />
          <div>
            <strong>Verified Cloudflare token</strong>
            <span>
              {inspection.accounts.length === 1
                ? `${inspection.accounts[0]?.name ?? "Account"} (${inspection.defaultAccountId})`
                : `${inspection.accounts.length} accounts available`}
            </span>
            <span>{inspection.userEmail ? `Default Access email: ${inspection.userEmail}` : "No user email returned"}</span>
          </div>
        </div>
      ) : null}

      {inspection && inspection.accounts.length > 1 ? (
        <div className="field">
          <label htmlFor="cf-account">Cloudflare account</label>
          <select
            id="cf-account"
            value={cloudflareAccountId}
            onChange={(event) => setCloudflareAccountId(event.target.value)}
            required
          >
            <option value="">Choose account</option>
            {inspection.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name ?? account.id}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="access-email">Access owner email</label>
        <input
          id="access-email"
          type="email"
          value={accessAllowedEmail}
          onChange={(event) => setAccessAllowedEmail(event.target.value)}
          placeholder="Filled from token verification"
        />
        <span className="field-hint">
          Optional before verification. By default the agent is locked to the email associated with
          the Cloudflare token.
        </span>
      </div>

      <div className="field">
        <label htmlFor="extra-emails">Additional Access emails</label>
        <textarea
          id="extra-emails"
          value={accessAdditionalEmails}
          onChange={(event) => setAccessAdditionalEmails(event.target.value)}
          placeholder="teammate@example.com, ops@example.com"
        />
      </div>

      <div className="field">
        <label htmlFor="default-model">Default model</label>
        <select
          id="default-model"
          value={defaultModel}
          onChange={(event) => setDefaultModel(event.target.value)}
        >
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {selectedModel?.description} Active default: {selectedProvider === "workers-ai" ? "Workers AI" : selectedProvider}.
        </span>
      </div>

      <div className="field">
        <label htmlFor="thinking-level">Thinking level</label>
        <select
          id="thinking-level"
          value={thinkingLevel}
          onChange={(event) =>
            setThinkingLevel(event.target.value as "low" | "medium" | "high" | "xhigh")
          }
        >
          {thinkingOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="field-hint">
          Medium is the default. Provider-backed models receive this as their reasoning effort when supported.
        </span>
      </div>

      <div className="personal-agent-panel">
        <div className="personal-agent-header">
          <div>
            <span className="eyebrow">Personal agent</span>
            <h3>Brain and stack setup</h3>
            <p>
              Choose the memory and workflow subsystem. OpenThink seeds the setup into the deployed
              agent during provisioning.
            </p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={personalAgentEnabled}
              onChange={(event) => setPersonalAgentEnabled(event.target.checked)}
            />
            <span>{personalAgentEnabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>

        {personalAgentEnabled ? (
          <>
            <PersonalAgentConfigurator
              state={personalAgentConfig}
              onChange={setPersonalAgentConfig}
              idPrefix="launch-personal-agent"
              presetInput="cards"
              showSetupSequence
              featureSummaryLimit={7}
              customNameLabel="Custom stack name"
              soulPromptLabel="Custom .brain / soul prompt"
              launchBriefLabel="Initial launch brief"
            />
            {personalAgentIssue ? <p className="notice">{personalAgentIssue}</p> : null}
          </>
        ) : null}
      </div>

      <details className="advanced-provider">
        <summary>Advanced BYOK provider keys</summary>
        <p className="field-hint">
          Optional. If multiple keys are entered, the selected default model decides which provider is used first.
          Kimi K2.6 uses Cloudflare Workers AI and needs no provider key.
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="openrouter-key">OpenRouter API key</label>
            <input
              id="openrouter-key"
              type="password"
              value={openRouterApiKey}
              onChange={(event) => setOpenRouterApiKey(event.target.value)}
              autoComplete="off"
              placeholder="sk-or-..."
            />
          </div>
          <div className="field">
            <label htmlFor="anthropic-key">Anthropic API key</label>
            <input
              id="anthropic-key"
              type="password"
              value={anthropicApiKey}
              onChange={(event) => setAnthropicApiKey(event.target.value)}
              autoComplete="off"
              placeholder="sk-ant-..."
            />
          </div>
          <div className="field">
            <label htmlFor="openai-key">OpenAI API key</label>
            <input
              id="openai-key"
              type="password"
              value={openAiApiKey}
              onChange={(event) => setOpenAiApiKey(event.target.value)}
              autoComplete="off"
              placeholder="sk-..."
            />
          </div>
        </div>
      </details>

      <label className="check-row">
        <input
          type="checkbox"
          checked={customDomainEnabled}
          onChange={(event) => {
            setCustomDomainEnabled(event.target.checked);
            if (event.target.checked && !customHostPrefixDirty) {
              setCustomHostPrefix(sanitizeDomainLabel(agentName));
            }
          }}
        />
        <span>Add an optional custom domain or subdomain for this agent.</span>
      </label>

      {customDomainEnabled ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="custom-zone">DNS zone</label>
            <select
              id="custom-zone"
              value={customZoneId}
              onChange={(event) => setCustomZoneId(event.target.value)}
            >
              <option value="">Choose zone</option>
              {inspection?.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Custom domain automation needs Zone Read, DNS Edit, and Workers Routes Edit.
            </span>
          </div>
          <div className="field">
            <label htmlFor="custom-host-prefix">Subdomain prefix</label>
            <div className="domain-builder">
              <input
                id="custom-host-prefix"
                value={effectiveHostPrefix}
                onChange={(event) => {
                  setCustomHostPrefixDirty(true);
                  setCustomHostPrefix(sanitizeDomainLabel(event.target.value));
                }}
                placeholder={suggestedHostPrefix || "agent"}
              />
              <span>.{selectedZone?.name ?? "choose-zone.com"}</span>
            </div>
            <span className="field-hint">
              Full hostname: <code>{customHostname || "choose a zone first"}</code>
            </span>
          </div>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="spend-limit">Monthly spend guardrail</label>
        <input
          id="spend-limit"
          type="number"
          min={5}
          max={100}
          value={spendLimitUsd}
          onChange={(event) => setSpendLimitUsd(Number(event.target.value))}
          required
        />
      </div>

      <button
        className="button button-primary"
        type="submit"
        disabled={isDeploying || !cfApiToken || Boolean(personalAgentIssue)}
      >
        {isDeploying ? <ShieldCheck size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        {isDeploying ? "Launching agent" : "Launch my personal agent"}
      </button>
    </form>
  );
}

function sanitizeDomainLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}
