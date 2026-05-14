"use client";

import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

interface RegistrarDomainResult {
  name: string;
  registrable: boolean;
  tier?: string;
  pricing?: {
    currency?: string;
    registration_cost?: string;
    renewal_cost?: string;
  };
  reason?: string;
}

interface RegistrarLookupPayload {
  search?: { domains?: RegistrarDomainResult[] };
  check?: { domains?: RegistrarDomainResult[] };
  purchasePrerequisites?: string[];
}

interface RegistrarRegisterResponse {
  accountId?: string;
  check?: { domains?: RegistrarDomainResult[] };
  registration?: {
    domain_name?: string;
    status?: string;
    workflow_status?: string;
    links?: {
      self?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  poll?: {
    platformPath?: string;
    cloudflareStatusPath?: string;
    cloudflare?: string;
  };
  message?: string;
  error?: string;
}

interface RegistrarStatusResponse {
  accountId?: string;
  domain?: string;
  status?: {
    state?: string;
    status?: string;
    workflow_status?: string;
    workflowStatus?: string;
    [key: string]: unknown;
  };
  terminal?: boolean;
  summary?: string;
  error?: string;
}

const launchChecks = [
  {
    label: "One scoped token",
    value: "Cloudflare opens a prefilled token screen; paste it here and verify once.",
    Icon: KeyRound
  },
  {
    label: "Private by default",
    value: "Cloudflare Access is attached before the launch returns a usable URL.",
    Icon: LockKeyhole
  },
  {
    label: "Agent OS included",
    value: "Goals, workspace orchestration, Code Mode MCP, sub-agents, and updates are seeded.",
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

const defaultAgentName = "orbit-forge";

export function SelfDeployFlow({ isDeploying, onDeploy }: SelfDeployFlowProps) {
  const [agentName, setAgentName] = useState(defaultAgentName);
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
  const [domainQuery, setDomainQuery] = useState("");
  const [registrarLookup, setRegistrarLookup] = useState<RegistrarLookupPayload | null>(null);
  const [registrarError, setRegistrarError] = useState<string | null>(null);
  const [isCheckingDomain, setIsCheckingDomain] = useState(false);
  const [registrarPurchaseCandidate, setRegistrarPurchaseCandidate] =
    useState<RegistrarDomainResult | null>(null);
  const [registrarConfirmation, setRegistrarConfirmation] = useState("");
  const [registrarMaxPrice, setRegistrarMaxPrice] = useState("");
  const [registrarAutoRenew, setRegistrarAutoRenew] = useState(false);
  const [registrarPurchaseResult, setRegistrarPurchaseResult] =
    useState<RegistrarRegisterResponse | null>(null);
  const [registrarPurchaseError, setRegistrarPurchaseError] = useState<string | null>(null);
  const [isRegisteringDomain, setIsRegisteringDomain] = useState(false);
  const [registrarStatus, setRegistrarStatus] = useState<RegistrarStatusResponse | null>(null);
  const [registrarStatusError, setRegistrarStatusError] = useState<string | null>(null);
  const [isCheckingRegistrationStatus, setIsCheckingRegistrationStatus] = useState(false);
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

  useEffect(() => {
    if (!registrarPurchaseResult || !registrarPurchaseCandidate || registrarStatus?.terminal) {
      return;
    }

    let cancelled = false;
    const pollStatus = async () => {
      setIsCheckingRegistrationStatus(true);
      try {
        const response = await fetch("/api/deployment/domain-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cfApiToken,
            cloudflareAccountId,
            domain: registrarPurchaseCandidate.name
          })
        });
        const body = (await response.json().catch(() => null)) as RegistrarStatusResponse | null;
        if (!response.ok || !body) {
          throw new Error(body?.error ?? "Domain registration status check failed.");
        }
        if (!cancelled) {
          setRegistrarStatus(body);
          setRegistrarStatusError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setRegistrarStatusError(
            error instanceof Error
              ? error.message
              : "Domain registration status check failed."
          );
        }
      } finally {
        if (!cancelled) {
          setIsCheckingRegistrationStatus(false);
        }
      }
    };

    void pollStatus();
    const interval = window.setInterval(() => {
      if (!cancelled) void pollStatus();
    }, 7000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    cfApiToken,
    cloudflareAccountId,
    registrarPurchaseCandidate,
    registrarPurchaseResult,
    registrarStatus?.terminal
  ]);

  async function verifyToken() {
    setVerifyError(null);
    setPermissionIssue(null);
    setInspection(null);
    setIsVerifying(true);
    try {
      const response = await fetch("/api/deployment/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cfApiToken,
          cloudflareAccountId,
          customDomainZoneId: customDomainEnabled ? customZoneId : undefined
        })
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

  async function checkDomainAvailability() {
    const query = domainQuery.trim();
    if (!query) return;

    setRegistrarError(null);
    setRegistrarLookup(null);
    setRegistrarPurchaseCandidate(null);
    setRegistrarPurchaseResult(null);
    setRegistrarPurchaseError(null);
    setRegistrarStatus(null);
    setRegistrarStatusError(null);
    setIsCheckingDomain(true);
    try {
      const response = await fetch("/api/deployment/domain-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cfApiToken,
          cloudflareAccountId,
          query,
          domains: query.includes(".") ? [query] : undefined
        })
      });
      const body = (await response.json().catch(() => null)) as
        | (RegistrarLookupPayload & { error?: string })
        | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? "Domain check failed.");
      }
      setRegistrarLookup(body);
    } catch (error) {
      setRegistrarError(error instanceof Error ? error.message : "Domain check failed.");
    } finally {
      setIsCheckingDomain(false);
    }
  }

  function prepareDomainRegistration(domain: RegistrarDomainResult) {
    setRegistrarPurchaseCandidate(domain);
    setRegistrarConfirmation("");
    setRegistrarPurchaseResult(null);
    setRegistrarPurchaseError(null);
    setRegistrarStatus(null);
    setRegistrarStatusError(null);
    setRegistrarAutoRenew(false);
    setRegistrarMaxPrice(domain.pricing?.registration_cost ?? "");
  }

  async function registerDomain() {
    if (!registrarPurchaseCandidate) return;

    setRegistrarPurchaseError(null);
    setRegistrarPurchaseResult(null);
    setIsRegisteringDomain(true);
    try {
      const response = await fetch("/api/deployment/domain-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cfApiToken,
          cloudflareAccountId,
          domain: registrarPurchaseCandidate.name,
          confirmation: registrarConfirmation,
          maxRegistrationCost: registrarMaxPrice,
          expectedCurrency: registrarPurchaseCandidate.pricing?.currency,
          autoRenew: registrarAutoRenew
        })
      });
      const body = (await response.json().catch(() => null)) as RegistrarRegisterResponse | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? "Domain registration failed.");
      }
      setRegistrarPurchaseResult(body);
      setRegistrarStatus(null);
      setRegistrarStatusError(null);
    } catch (error) {
      setRegistrarPurchaseError(
        error instanceof Error ? error.message : "Domain registration failed."
      );
    } finally {
      setIsRegisteringDomain(false);
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
        <strong>Start with the minimum required setup</strong>
        <p>
          Create a scoped Cloudflare token, paste it here, and verify. The form fills the
          account, owner email, available zones, and sane defaults after verification.
        </p>
        <p className="credential-warning">
          The token is fingerprinted in platform metadata, never stored raw. The deployed agent
          receives it only as a Worker secret for Cloudflare MCP/API operations.
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
        <div className="inline-control">
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
          <button
            className="button"
            type="button"
            onClick={() => {
              const nextName = funAgentName();
              setAgentName(nextName);
              if (!customHostPrefixDirty) {
                setCustomHostPrefix(sanitizeDomainLabel(nextName));
              }
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            New
          </button>
        </div>
        <span className="field-hint">
          Two short words make the Worker, Access app, and optional subdomain easy to recognize.
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
          Required for launch. The token needs Workers, D1, R2, Queues, Vectorize, Workers AI,
          Access, and optional DNS/routes permissions.
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

      <div className="registrar-panel">
        <div>
          <strong>Need a new domain?</strong>
          <p>
            Check Cloudflare Registrar availability and price before launch. This does not buy the
            domain; registration is billable and non-refundable once confirmed.
          </p>
        </div>
        <div className="inline-control">
          <input
            value={domainQuery}
            onChange={(event) => setDomainQuery(event.target.value)}
            placeholder="orbitforge.dev or a project phrase"
            aria-label="Domain search phrase or exact domain"
          />
          <button
            className="button"
            type="button"
            disabled={!cfApiToken || !domainQuery.trim() || isCheckingDomain}
            onClick={checkDomainAvailability}
          >
            <Search size={14} aria-hidden="true" />
            {isCheckingDomain ? "Checking" : "Check"}
          </button>
        </div>
        <span className="field-hint">
          Registrar checks need Account Registrar Write plus billing, contact, and registration
          agreement setup in Cloudflare. Stripe Projects remains the future zero-touch path for new
          Cloudflare accounts.
        </span>
        {registrarError ? <p className="notice">{registrarError}</p> : null}
        {registrarLookup ? (
          <RegistrarResults
            payload={registrarLookup}
            onRegisterCandidate={prepareDomainRegistration}
          />
        ) : null}
        {registrarPurchaseCandidate ? (
          <div className="registrar-purchase" aria-label="Domain registration confirmation">
            <div>
              <strong>Register {registrarPurchaseCandidate.name}</strong>
              <p>
                Cloudflare will charge the account default payment method if registration
                succeeds. Type <code>REGISTER {registrarPurchaseCandidate.name}</code> and set a
                maximum price to continue.
              </p>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="registrar-confirmation">Confirmation phrase</label>
                <input
                  id="registrar-confirmation"
                  value={registrarConfirmation}
                  onChange={(event) => setRegistrarConfirmation(event.target.value)}
                  placeholder={`REGISTER ${registrarPurchaseCandidate.name}`}
                />
              </div>
              <div className="field">
                <label htmlFor="registrar-max-price">Maximum registration price</label>
                <input
                  id="registrar-max-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={registrarMaxPrice}
                  onChange={(event) => setRegistrarMaxPrice(event.target.value)}
                  placeholder="10.11"
                />
                <span className="field-hint">
                  Latest quoted price: {formatRegistrarPrice(registrarPurchaseCandidate)}
                </span>
              </div>
            </div>
            <label className="check-row check-row-compact">
              <input
                type="checkbox"
                checked={registrarAutoRenew}
                onChange={(event) => setRegistrarAutoRenew(event.target.checked)}
              />
              <span>
                <strong>Enable auto-renew</strong>
                <small>
                  Optional. This authorizes future renewal charges through Cloudflare Registrar.
                </small>
              </span>
            </label>
            <button
              className="button button-danger"
              type="button"
              disabled={
                isRegisteringDomain ||
                registrarConfirmation.trim() !== `REGISTER ${registrarPurchaseCandidate.name}` ||
                !registrarMaxPrice
              }
              onClick={registerDomain}
            >
              {isRegisteringDomain ? "Registering" : "Register domain"}
            </button>
            {registrarPurchaseError ? <p className="notice">{registrarPurchaseError}</p> : null}
            {registrarPurchaseResult ? (
              <p className="notice notice-success">
                {registrarPurchaseResult.message ??
                  `Registration submitted for ${registrarPurchaseCandidate.name}.`}
              </p>
            ) : null}
            {registrarPurchaseResult ? (
              <div className="registrar-status" aria-label="Domain registration status">
                <strong>Registration status</strong>
                <span>
                  {registrarStatus?.summary ??
                    (isCheckingRegistrationStatus
                      ? "Checking Cloudflare Registrar..."
                      : "Waiting for Cloudflare Registrar status.")}
                </span>
                {registrarStatus?.terminal ? (
                  <em className="ready">Terminal</em>
                ) : (
                  <em>Polling</em>
                )}
                {registrarStatusError ? <small>{registrarStatusError}</small> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

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
          Optional before verification. By default, Access uses the email returned by Cloudflare
          user details for this token.
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
        <span>
          <strong>Attach a custom domain or subdomain</strong>
          <small>
            Optional. The default launch uses a protected workers.dev URL; custom domains add DNS
            and Workers route automation.
          </small>
        </span>
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

function RegistrarResults({
  payload,
  onRegisterCandidate
}: {
  payload: RegistrarLookupPayload;
  onRegisterCandidate: (domain: RegistrarDomainResult) => void;
}) {
  const checked = payload.check?.domains ?? [];
  const searched = payload.search?.domains ?? [];
  const domains = dedupeRegistrarDomains([...checked, ...searched]);
  if (domains.length === 0) {
    return <p className="field-hint">No supported Registrar results were returned for this search.</p>;
  }

  return (
    <div className="registrar-results" aria-label="Cloudflare Registrar availability results">
      {domains.map((domain) => (
        <div className="registrar-result" key={domain.name}>
          <span>
            <strong>{domain.name}</strong>
            <small>
              {domain.registrable
                ? formatRegistrarPrice(domain)
                : domain.reason ?? "Not registrable through the Registrar API"}
            </small>
          </span>
          <em className={domain.registrable ? "ready" : "blocked"}>
            {domain.registrable ? "Available" : "Unavailable"}
          </em>
          {domain.registrable ? (
            <button
              className="button button-small"
              type="button"
              onClick={() => onRegisterCandidate(domain)}
            >
              Register
            </button>
          ) : null}
        </div>
      ))}
      {payload.purchasePrerequisites?.length ? (
        <details className="registrar-prerequisites">
          <summary>Purchase prerequisites</summary>
          <ul>
            {payload.purchasePrerequisites.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function dedupeRegistrarDomains(domains: RegistrarDomainResult[]): RegistrarDomainResult[] {
  const seen = new Set<string>();
  return domains.filter((domain) => {
    const key = domain.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatRegistrarPrice(domain: RegistrarDomainResult): string {
  const cost = domain.pricing?.registration_cost;
  const currency = domain.pricing?.currency ?? "USD";
  const renewal = domain.pricing?.renewal_cost;
  if (!cost) return "Current price unavailable; confirm again before purchase.";
  return renewal && renewal !== cost
    ? `${currency} ${cost} registration, ${renewal} renewal`
    : `${currency} ${cost} registration`;
}

function sanitizeDomainLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function funAgentName(): string {
  const first = [
    "bright",
    "signal",
    "orbit",
    "kindle",
    "north",
    "maple",
    "cinder",
    "paper",
    "vector",
    "pilot",
    "ember",
    "cobalt"
  ];
  const second = [
    "forge",
    "lantern",
    "harbor",
    "atlas",
    "sketch",
    "relay",
    "garden",
    "thread",
    "compass",
    "studio",
    "signal",
    "runner"
  ];
  const left = first[Math.floor(Math.random() * first.length)] ?? "bright";
  const right = second[Math.floor(Math.random() * second.length)] ?? "forge";
  return `${left}-${right}`;
}
