"use client";

import { BrainCircuit, Layers3, Settings2 } from "lucide-react";
import { useMemo } from "react";
import {
  defaultPersonalAgentPresetId,
  defaultPersonalAgentToolApprovalPolicy,
  personalAgentFeatureCatalog,
  personalAgentFeatureDefaultsForPreset,
  personalAgentPresetById,
  personalAgentSubsystemPresets,
  personalAgentToolApprovalPolicies,
  type PersonalAgentFeatureGroup,
  type PersonalAgentFeatureKey,
  type PersonalAgentPresetId,
  type PersonalAgentSubsystemConfig,
  type PersonalAgentToolApprovalPolicy
} from "@/lib/personal-agent-options";

export interface PersonalAgentConfiguratorState {
  presetId: PersonalAgentPresetId;
  advancedMode: boolean;
  toolApprovalPolicy: PersonalAgentToolApprovalPolicy;
  features: Record<PersonalAgentFeatureKey, boolean>;
  customName: string;
  soulPrompt: string;
  launchBrief: string;
  externalEndpoint: string;
}

interface PersonalAgentConfiguratorProps {
  state: PersonalAgentConfiguratorState;
  onChange: (state: PersonalAgentConfiguratorState) => void;
  idPrefix: string;
  presetInput?: "cards" | "select";
  presetLabel?: string;
  presetHint?: string;
  showSetupSequence?: boolean;
  featureSummaryLimit?: number | "all";
  summaryClassName?: string;
  customNameLabel?: string;
  soulPromptLabel?: string;
  launchBriefLabel?: string;
  soulPromptHint?: string;
  launchBriefHint?: string;
  externalEndpointHint?: string;
  toolApprovalPolicyLabel?: string;
  toolApprovalPolicyHint?: string;
  advancedLabel?: string;
  advancedHint?: string;
}

export function createPersonalAgentConfiguratorState(
  presetId: PersonalAgentPresetId = defaultPersonalAgentPresetId
): PersonalAgentConfiguratorState {
  return {
    presetId,
    advancedMode: false,
    toolApprovalPolicy: defaultPersonalAgentToolApprovalPolicy,
    features: personalAgentFeatureDefaultsForPreset(presetId),
    customName: "",
    soulPrompt: "",
    launchBrief: "",
    externalEndpoint: ""
  };
}

export function personalAgentConfigFromConfiguratorState(
  state: PersonalAgentConfiguratorState,
  options: { enabled?: boolean } = {}
): PersonalAgentSubsystemConfig {
  const config: PersonalAgentSubsystemConfig = {
    enabled: options.enabled ?? true,
    presetId: state.presetId,
    toolApprovalPolicy: state.toolApprovalPolicy,
    advancedMode: state.advancedMode,
    features: state.features
  };
  if (state.customName.trim()) config.customName = state.customName.trim();
  if (state.soulPrompt.trim()) config.soulPrompt = state.soulPrompt.trim();
  if (state.launchBrief.trim()) config.launchBrief = state.launchBrief.trim();
  if (state.externalEndpoint.trim()) config.externalEndpoint = state.externalEndpoint.trim();
  return config;
}

export function personalAgentConfiguratorIssue(
  state: PersonalAgentConfiguratorState,
  message = "Custom .brain setup needs a stack name or a soul prompt."
): string | null {
  return state.presetId === "custom" && !state.customName.trim() && !state.soulPrompt.trim()
    ? message
    : null;
}

export function PersonalAgentConfigurator({
  state,
  onChange,
  idPrefix,
  presetInput = "cards",
  presetLabel = "Brain/stack",
  presetHint,
  showSetupSequence = false,
  featureSummaryLimit = 7,
  summaryClassName,
  customNameLabel = "Custom stack name",
  soulPromptLabel = "Custom .brain / soul prompt",
  launchBriefLabel = "Initial launch brief",
  soulPromptHint = "Optional. This is added to the deployed agent's system instructions and redacted from public runtime status.",
  launchBriefHint = "Optional. This is stored as the first launch-brief memory and included as initial mission context without replacing the durable soul prompt.",
  externalEndpointHint = "Optional during launch. If blank, the agent records setup follow-ups for the external workstation or memory server.",
  toolApprovalPolicyLabel = "MCP tool approval policy",
  toolApprovalPolicyHint = "Default is Auto. You can change this later from deployment settings or during factory reset.",
  advancedLabel = "Advanced mode",
  advancedHint = "Choose exactly which personal-agent features are on."
}: PersonalAgentConfiguratorProps) {
  const selectedPreset = personalAgentPresetById(state.presetId);
  const setupMode = setupModeForPreset(selectedPreset.setupKind);
  const enabledFeatureDefinitions = personalAgentFeatureCatalog.filter(
    (feature) => state.features[feature.id]
  );
  const displayedFeatures =
    featureSummaryLimit === "all"
      ? enabledFeatureDefinitions
      : enabledFeatureDefinitions.slice(0, featureSummaryLimit);
  const hiddenFeatureCount =
    featureSummaryLimit === "all"
      ? 0
      : Math.max(0, enabledFeatureDefinitions.length - featureSummaryLimit);
  const featureGroups = useMemo(
    () =>
      personalAgentFeatureCatalog.reduce(
        (groups, feature) => {
          groups[feature.group].push(feature);
          return groups;
        },
        {
          Memory: [],
          Retrieval: [],
          Tools: [],
          Autonomy: [],
          Local: []
        } as Record<PersonalAgentFeatureGroup, typeof personalAgentFeatureCatalog>
      ),
    []
  );

  function patch(next: Partial<PersonalAgentConfiguratorState>) {
    onChange({ ...state, ...next });
  }

  function setPreset(presetId: PersonalAgentPresetId) {
    onChange({
      ...state,
      presetId,
      features: personalAgentFeatureDefaultsForPreset(presetId)
    });
  }

  return (
    <>
      {presetInput === "cards" ? (
        <div className="preset-picker" role="radiogroup" aria-label="Brain and stack presets">
          {personalAgentSubsystemPresets.map((preset) => {
            const isSelected = preset.id === state.presetId;
            const mode = setupModeForPreset(preset.setupKind);

            return (
              <button
                key={preset.id}
                className="preset-option"
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-active={isSelected}
                onClick={() => setPreset(preset.id)}
              >
                <span className="preset-option-top">
                  <strong>{preset.label}</strong>
                  <span data-mode={mode.tone}>{mode.label}</span>
                </span>
                <small>{preset.summary}</small>
                <span className="preset-option-meta">
                  <span>{preset.brain}</span>
                  <span>{preset.stack}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="field">
          <label htmlFor={`${idPrefix}-preset`}>{presetLabel}</label>
          <select
            id={`${idPrefix}-preset`}
            value={state.presetId}
            onChange={(event) => setPreset(event.target.value as PersonalAgentPresetId)}
          >
            {personalAgentSubsystemPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          {presetHint ? <span className="field-hint">{presetHint}</span> : null}
        </div>
      )}

      <div
        className={
          summaryClassName
            ? `agent-stack-summary ${summaryClassName}`
            : "agent-stack-summary"
        }
        aria-label="Selected personal agent subsystem"
      >
        <div>
          <BrainCircuit size={17} aria-hidden="true" />
          <span>
            <strong>{selectedPreset.brain}</strong>
            <small>Brain</small>
          </span>
        </div>
        <div>
          <Layers3 size={17} aria-hidden="true" />
          <span>
            <strong>{selectedPreset.stack}</strong>
            <small>Stack</small>
          </span>
        </div>
        <div>
          <Settings2 size={17} aria-hidden="true" />
          <span>
            <strong>{setupMode.label}</strong>
            <small>Setup</small>
          </span>
        </div>
      </div>

      {showSetupSequence ? (
        <div className="setup-sequence" aria-label="Personal agent setup sequence">
          <div data-active="true">
            <span>1</span>
            <strong>D1 setup</strong>
            <small>Profile and feature flags are seeded during provisioning.</small>
          </div>
          <div data-active="true">
            <span>2</span>
            <strong>Runtime context</strong>
            <small>Health, manifest, and chat load the selected brain profile.</small>
          </div>
          <div data-active={selectedPreset.setupKind === "native" ? "true" : "pending"}>
            <span>3</span>
            <strong>{selectedPreset.setupKind === "native" ? "Ready on launch" : "External bridge"}</strong>
            <small>
              {selectedPreset.setupKind === "native"
                ? "No extra memory server is required."
                : "The agent records follow-ups until an endpoint or workstation is connected."}
            </small>
          </div>
        </div>
      ) : null}

      <div className="enabled-feature-strip" aria-label="Enabled personal agent features">
        <strong>{enabledFeatureDefinitions.length} features on</strong>
        <div>
          {displayedFeatures.map((feature) => (
            <span key={feature.id}>{feature.label}</span>
          ))}
          {hiddenFeatureCount ? <span>+{hiddenFeatureCount} more</span> : null}
        </div>
      </div>

      <div className="field">
        <label id={`${idPrefix}-tool-policy-label`}>{toolApprovalPolicyLabel}</label>
        <div
          className="policy-choice-grid"
          role="radiogroup"
          aria-labelledby={`${idPrefix}-tool-policy-label`}
        >
          {personalAgentToolApprovalPolicies.map((policy) => {
            const copy = toolApprovalPolicyCopy(policy);
            const isSelected = state.toolApprovalPolicy === policy;
            return (
              <button
                className="policy-option"
                data-active={isSelected}
                key={policy}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => patch({ toolApprovalPolicy: policy })}
              >
                <strong>{copy.label}</strong>
                <small>{copy.summary}</small>
              </button>
            );
          })}
        </div>
        <span className="field-hint">{toolApprovalPolicyHint}</span>
      </div>

      {state.presetId === "custom" ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-custom-name`}>{customNameLabel}</label>
          <input
            id={`${idPrefix}-custom-name`}
            value={state.customName}
            onChange={(event) => patch({ customName: event.target.value })}
            placeholder="Research .brain"
          />
        </div>
      ) : null}

      {selectedPreset.setupKind !== "native" ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-external-endpoint`}>External endpoint or MCP URL</label>
          <input
            id={`${idPrefix}-external-endpoint`}
            value={state.externalEndpoint}
            onChange={(event) => patch({ externalEndpoint: event.target.value })}
            placeholder="https://memory.example.com/mcp"
          />
          <span className="field-hint">{externalEndpointHint}</span>
        </div>
      ) : null}

      <div className="form-grid personal-agent-prompt-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-soul-prompt`}>{soulPromptLabel}</label>
          <textarea
            id={`${idPrefix}-soul-prompt`}
            value={state.soulPrompt}
            onChange={(event) => patch({ soulPrompt: event.target.value })}
            placeholder="Durable identity, operating principles, memory rules, and preferences."
            maxLength={8000}
          />
          <span className="field-hint">{soulPromptHint}</span>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-launch-brief`}>{launchBriefLabel}</label>
          <textarea
            id={`${idPrefix}-launch-brief`}
            value={state.launchBrief}
            onChange={(event) => patch({ launchBrief: event.target.value })}
            placeholder="Current mission, active projects, or first goals."
            maxLength={12000}
          />
          <span className="field-hint">{launchBriefHint}</span>
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={state.advancedMode}
          onChange={(event) => patch({ advancedMode: event.target.checked })}
        />
        <span>
          <strong>{advancedLabel}</strong>
          <small>{advancedHint}</small>
        </span>
      </label>

      {state.advancedMode ? (
        <div className="feature-group-list" aria-label="Personal agent feature toggles">
          {(Object.keys(featureGroups) as PersonalAgentFeatureGroup[]).map((group) => (
            <fieldset className="feature-group" key={group}>
              <legend>{group}</legend>
              <div className="feature-toggle-grid">
                {featureGroups[group].map((feature) => (
                  <label className="feature-toggle" key={feature.id}>
                    <input
                      type="checkbox"
                      checked={state.features[feature.id]}
                      onChange={(event) =>
                        patch({
                          features: {
                            ...state.features,
                            [feature.id]: event.target.checked
                          }
                        })
                      }
                    />
                    <span>
                      <strong>{feature.label}</strong>
                      <small>{feature.summary}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function setupModeForPreset(setupKind: string): { label: string; tone: "ready" | "bridge" } {
  if (setupKind === "native" || setupKind === "custom" || setupKind === "markdown-zettelkasten") {
    return { label: "Auto bootstrap", tone: "ready" };
  }
  return { label: "Bridge needed", tone: "bridge" };
}

function toolApprovalPolicyCopy(
  policy: PersonalAgentToolApprovalPolicy
): { label: string; summary: string } {
  switch (policy) {
    case "auto":
      return {
        label: "Auto",
        summary: "Run read/status work and goal-scoped low-risk operations; ask for destructive, spend, secret, or identity changes."
      };
    case "ask-every-time":
      return {
        label: "Ask every time",
        summary: "Require owner approval before any MCP tool call runs."
      };
    case "allow-all":
      return {
        label: "Allow all",
        summary: "Run MCP tools and built-in approval checkpoints without prompts. Legacy alias for Full auto."
      };
    case "full-auto":
      return {
        label: "Full auto",
        summary: "Always approve tool calls for this agent. Use only with scoped tokens, spend limits, and trusted goals."
      };
  }
}
