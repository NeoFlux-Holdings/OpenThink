export const personalAgentFeatureKeys = [
  "coreMemory",
  "profileMemory",
  "episodicMemory",
  "semanticMemory",
  "knowledgeGraph",
  "mcpBridge",
  "taskQueue",
  "fileWorkspace",
  "proactiveRoutines",
  "browserAutomation",
  "multiAgent",
  "localFirst",
  "healthTracking"
] as const;

export type PersonalAgentFeatureKey = (typeof personalAgentFeatureKeys)[number];

export const personalAgentToolApprovalPolicies = [
  "auto",
  "ask-every-time",
  "allow-all",
  "full-auto"
] as const;

export type PersonalAgentToolApprovalPolicy = (typeof personalAgentToolApprovalPolicies)[number];

export type PersonalAgentPresetId =
  | "openthink-gbrain-gstack"
  | "aibrain"
  | "copaw"
  | "memmachine"
  | "mem0"
  | "zep-graphiti"
  | "thoth"
  | "hivemind"
  | "memforge"
  | "custom";

export type PersonalAgentSetupKind =
  | "native"
  | "mcp-memory-server"
  | "external-workstation"
  | "temporal-graph"
  | "markdown-zettelkasten"
  | "custom";

export type PersonalAgentFeatureGroup =
  | "Memory"
  | "Retrieval"
  | "Tools"
  | "Autonomy"
  | "Local";

export interface PersonalAgentFeatureDefinition {
  id: PersonalAgentFeatureKey;
  label: string;
  summary: string;
  group: PersonalAgentFeatureGroup;
}

export interface PersonalAgentSubsystemPreset {
  id: PersonalAgentPresetId;
  label: string;
  stack: string;
  brain: string;
  summary: string;
  setupKind: PersonalAgentSetupKind;
  defaultFeatures: PersonalAgentFeatureKey[];
  setupSteps: string[];
  sourceLabel?: string;
  sourceUrl?: string;
}

export interface PersonalAgentSubsystemConfig {
  enabled?: boolean;
  presetId?: PersonalAgentPresetId;
  toolApprovalPolicy?: PersonalAgentToolApprovalPolicy;
  customName?: string;
  soulPrompt?: string;
  soulPromptConfigured?: boolean;
  launchBrief?: string;
  launchBriefConfigured?: boolean;
  advancedMode?: boolean;
  features?: Partial<Record<PersonalAgentFeatureKey, boolean>>;
  externalEndpoint?: string;
}

export interface NormalizedPersonalAgentSubsystemConfig {
  enabled: boolean;
  presetId: PersonalAgentPresetId;
  label: string;
  stack: string;
  brain: string;
  summary: string;
  setupKind: PersonalAgentSetupKind;
  advancedMode: boolean;
  features: Record<PersonalAgentFeatureKey, boolean>;
  enabledFeatures: PersonalAgentFeatureKey[];
  setupSteps: string[];
  setupStatus: "disabled" | "complete" | "external-runtime-needed";
  toolApprovalPolicy: PersonalAgentToolApprovalPolicy;
  soulPromptConfigured: boolean;
  launchBriefConfigured: boolean;
  customName?: string;
  soulPrompt?: string;
  launchBrief?: string;
  externalEndpoint?: string;
  sourceLabel?: string;
  sourceUrl?: string;
}

export const defaultPersonalAgentPresetId: PersonalAgentPresetId = "openthink-gbrain-gstack";
export const defaultPersonalAgentToolApprovalPolicy: PersonalAgentToolApprovalPolicy = "auto";

export const personalAgentFeatureCatalog: PersonalAgentFeatureDefinition[] = [
  {
    id: "coreMemory",
    label: "Core memory",
    summary: "Persist durable notes and setup state in D1.",
    group: "Memory"
  },
  {
    id: "profileMemory",
    label: "Profile memory",
    summary: "Track durable user preferences, facts, and working style.",
    group: "Memory"
  },
  {
    id: "episodicMemory",
    label: "Episodic memory",
    summary: "Retain conversation and event context across sessions.",
    group: "Memory"
  },
  {
    id: "semanticMemory",
    label: "Semantic recall",
    summary: "Use Vectorize or an external backend for similarity search.",
    group: "Retrieval"
  },
  {
    id: "knowledgeGraph",
    label: "Knowledge graph",
    summary: "Model people, projects, facts, events, and relationships.",
    group: "Retrieval"
  },
  {
    id: "mcpBridge",
    label: "MCP bridge",
    summary: "Expose or connect memory and tools through MCP servers.",
    group: "Tools"
  },
  {
    id: "taskQueue",
    label: "Task queue",
    summary: "Queue background tasks and setup follow-ups.",
    group: "Tools"
  },
  {
    id: "fileWorkspace",
    label: "File workspace",
    summary: "Use R2 or a local workspace as the artifact layer.",
    group: "Tools"
  },
  {
    id: "proactiveRoutines",
    label: "Proactive routines",
    summary: "Enable scheduled review, consolidation, and goal check-ins.",
    group: "Autonomy"
  },
  {
    id: "browserAutomation",
    label: "Browser automation",
    summary: "Plan browser or channel automation through approved tools.",
    group: "Autonomy"
  },
  {
    id: "multiAgent",
    label: "Multi-agent",
    summary: "Coordinate specialist agents, handoffs, and shared context.",
    group: "Autonomy"
  },
  {
    id: "localFirst",
    label: "Local-first",
    summary: "Prefer user-controlled storage and local model/tool routes.",
    group: "Local"
  },
  {
    id: "healthTracking",
    label: "Health tracking",
    summary: "Track operational health, routines, and recovery steps.",
    group: "Local"
  }
];

export const personalAgentSubsystemPresets: PersonalAgentSubsystemPreset[] = [
  {
    id: "openthink-gbrain-gstack",
    label: "OpenThink gbrain + gstack",
    stack: "gstack",
    brain: "gbrain",
    summary:
      "Cloudflare-native second brain using D1 memory, R2 files, Queue tasks, Vectorize semantic recall, MCP tools, and runtime setup state.",
    setupKind: "native",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "semanticMemory",
      "mcpBridge",
      "taskQueue",
      "fileWorkspace",
      "proactiveRoutines"
    ],
    setupSteps: [
      "Create personal_agent_setup in D1",
      "Seed the selected brain/stack profile into D1 memory",
      "Expose the profile through health, manifest, runtime context, and chat instructions"
    ]
  },
  {
    id: "aibrain",
    label: "AIBrain",
    stack: "AIBrain OS",
    brain: "SQLite/FTS brain with workflows",
    summary:
      "Comprehensive local memory OS with MCP servers, document ingestion, agent teams, flow engine, dashboard, and self-learning workflows.",
    setupKind: "mcp-memory-server",
    sourceLabel: "myaibrain.org",
    sourceUrl: "https://myaibrain.org/",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "semanticMemory",
      "knowledgeGraph",
      "mcpBridge",
      "proactiveRoutines",
      "multiAgent",
      "localFirst"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Prepare MCP registration instructions for an AIBrain memory server",
      "Queue the owner follow-up to run aibrain setup on the target workstation"
    ]
  },
  {
    id: "copaw",
    label: "CoPaw",
    stack: "AgentScope workstation",
    brain: "CoPaw long-term assistant memory",
    summary:
      "AgentScope-based personal workstation for local/cloud deployment, modular agents, channels, local models, and long-running assistant memory.",
    setupKind: "external-workstation",
    sourceLabel: "copaw.bot",
    sourceUrl: "https://copaw.bot/",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "mcpBridge",
      "browserAutomation",
      "multiAgent",
      "localFirst"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Prepare CoPaw workstation launch instructions",
      "Queue channel and local-model configuration as owner follow-ups"
    ]
  },
  {
    id: "memmachine",
    label: "MemMachine",
    stack: "MemMachine server",
    brain: "Working, episodic, and profile memory",
    summary:
      "Memory layer with working memory, graph-backed episodic memory, SQL profile memory, SDKs, REST API, and native MCP server support.",
    setupKind: "mcp-memory-server",
    sourceLabel: "MemMachine GitHub",
    sourceUrl: "https://github.com/MemMachine/MemMachine",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "semanticMemory",
      "knowledgeGraph",
      "mcpBridge"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Prepare MemMachine server endpoint and MCP connection placeholders",
      "Map OpenThink memories to working, episodic, and profile lanes"
    ]
  },
  {
    id: "mem0",
    label: "Mem0",
    stack: "Mem0 SDK/server",
    brain: "User, session, and agent memory",
    summary:
      "Production memory layer with multi-level memory, hybrid retrieval, hosted or self-hosted deployment, Python and TypeScript SDKs, and CLI support.",
    setupKind: "mcp-memory-server",
    sourceLabel: "mem0 GitHub",
    sourceUrl: "https://github.com/mem0ai/mem0",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "semanticMemory",
      "mcpBridge"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Prepare Mem0 API/server configuration placeholders",
      "Map user, session, and agent memory into the runtime context"
    ]
  },
  {
    id: "zep-graphiti",
    label: "Zep / Graphiti",
    stack: "Temporal graph memory",
    brain: "Graphiti temporal knowledge graph",
    summary:
      "Temporal knowledge graph approach that keeps historical relationships across conversational and structured data for time-aware recall.",
    setupKind: "temporal-graph",
    sourceLabel: "Zep paper",
    sourceUrl: "https://arxiv.org/abs/2501.13956",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "semanticMemory",
      "knowledgeGraph",
      "mcpBridge"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Prepare temporal graph configuration placeholders",
      "Mark graph extraction and relationship consolidation as setup follow-ups"
    ]
  },
  {
    id: "thoth",
    label: "Thoth",
    stack: "Local-first desktop assistant",
    brain: "Personal knowledge graph",
    summary:
      "Local-first assistant with durable graph memory, workflows, messaging, plugins, MCP tools, browser/delegation flows, and provider-aware routing.",
    setupKind: "external-workstation",
    sourceLabel: "get-thoth.com",
    sourceUrl: "https://get-thoth.com/",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "knowledgeGraph",
      "mcpBridge",
      "browserAutomation",
      "localFirst",
      "healthTracking"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Prepare Thoth workstation and MCP bridge instructions",
      "Queue local-first data boundary and provider route review"
    ]
  },
  {
    id: "hivemind",
    label: "Hivemind",
    stack: "Multi-agent team platform",
    brain: "DB-backed agent workspace",
    summary:
      "Multi-agent platform where agents live in persistent workspaces with team chat, memory, tool assignment, channels, and collaboration state.",
    setupKind: "external-workstation",
    sourceLabel: "Hivemind GitHub",
    sourceUrl: "https://github.com/hivementality-ai/hivemind",
    defaultFeatures: [
      "coreMemory",
      "episodicMemory",
      "mcpBridge",
      "taskQueue",
      "fileWorkspace",
      "proactiveRoutines",
      "multiAgent"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Prepare Hivemind workspace import instructions",
      "Queue agent role, tool, and channel assignment follow-ups"
    ]
  },
  {
    id: "memforge",
    label: "MemForge / A-MEM",
    stack: "Markdown knowledge base",
    brain: "Zettelkasten-style .brain",
    summary:
      "Plain Markdown memory workflow inspired by Zettelkasten and A-MEM, using human-readable notes, review, compile, recall, and git history.",
    setupKind: "markdown-zettelkasten",
    sourceLabel: "MemForge PyPI",
    sourceUrl: "https://pypi.org/project/memforge/",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "fileWorkspace",
      "localFirst"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Seed the .brain/soul.md prompt into runtime instructions when provided",
      "Prepare Markdown memory import, review, and recall conventions"
    ]
  },
  {
    id: "custom",
    label: "Custom .brain",
    stack: "Owner-defined stack",
    brain: "Owner-defined soul prompt",
    summary:
      "Custom stack and brain profile driven by the owner's prompt, similar to a soul.md for the deployed agent.",
    setupKind: "custom",
    defaultFeatures: [
      "coreMemory",
      "profileMemory",
      "episodicMemory",
      "semanticMemory",
      "mcpBridge",
      "taskQueue",
      "fileWorkspace"
    ],
    setupSteps: [
      "Bootstrap the OpenThink D1 setup record",
      "Seed the custom .brain prompt into runtime instructions",
      "Expose the custom profile through runtime context and chat setup"
    ]
  }
];

export function isPersonalAgentPresetId(value: unknown): value is PersonalAgentPresetId {
  return (
    typeof value === "string" &&
    personalAgentSubsystemPresets.some((preset) => preset.id === value)
  );
}

export function isPersonalAgentFeatureKey(value: unknown): value is PersonalAgentFeatureKey {
  return typeof value === "string" && personalAgentFeatureKeys.includes(value as PersonalAgentFeatureKey);
}

export function isPersonalAgentToolApprovalPolicy(
  value: unknown
): value is PersonalAgentToolApprovalPolicy {
  return (
    typeof value === "string" &&
    personalAgentToolApprovalPolicies.includes(value as PersonalAgentToolApprovalPolicy)
  );
}

export function normalizePersonalAgentToolApprovalPolicy(
  value: unknown
): PersonalAgentToolApprovalPolicy {
  if (isPersonalAgentToolApprovalPolicy(value)) return value;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (isPersonalAgentToolApprovalPolicy(normalized)) return normalized;
  if (normalized === "ask-everytime") return "ask-every-time";
  if (normalized === "allowall") return "allow-all";
  if (normalized === "fullauto" || normalized === "always-approve" || normalized === "alwaysapprove") {
    return "full-auto";
  }
  return defaultPersonalAgentToolApprovalPolicy;
}

export function personalAgentPresetById(id: PersonalAgentPresetId): PersonalAgentSubsystemPreset {
  return (
    personalAgentSubsystemPresets.find((preset) => preset.id === id) ??
    personalAgentSubsystemPresets[0]!
  );
}

export function personalAgentFeatureDefaultsForPreset(
  presetId: PersonalAgentPresetId
): Record<PersonalAgentFeatureKey, boolean> {
  const preset = personalAgentPresetById(presetId);
  const enabled = new Set<PersonalAgentFeatureKey>(preset.defaultFeatures);
  return Object.fromEntries(
    personalAgentFeatureKeys.map((key) => [key, enabled.has(key)])
  ) as Record<PersonalAgentFeatureKey, boolean>;
}

export function normalizePersonalAgentConfig(
  input?: PersonalAgentSubsystemConfig | null
): NormalizedPersonalAgentSubsystemConfig {
  const presetId = isPersonalAgentPresetId(input?.presetId)
    ? input.presetId
    : defaultPersonalAgentPresetId;
  const preset = personalAgentPresetById(presetId);
  const enabled = input ? input.enabled !== false : false;
  const advancedMode = Boolean(input?.advancedMode);
  const toolApprovalPolicy = normalizePersonalAgentToolApprovalPolicy(input?.toolApprovalPolicy);
  const features = personalAgentFeatureDefaultsForPreset(presetId);

  for (const [key, value] of Object.entries(input?.features ?? {})) {
    if (isPersonalAgentFeatureKey(key)) {
      features[key] = Boolean(value);
    }
  }

  const customName = trimBounded(input?.customName, 80);
  const soulPrompt = trimBounded(input?.soulPrompt, 8000);
  const launchBrief = trimBounded(input?.launchBrief, 12000);
  const externalEndpoint = trimBounded(input?.externalEndpoint, 500);
  const soulPromptConfigured = Boolean(enabled && (soulPrompt || input?.soulPromptConfigured));
  const launchBriefConfigured = Boolean(enabled && (launchBrief || input?.launchBriefConfigured));
  const enabledFeatures = personalAgentFeatureKeys.filter((key) => features[key]);
  const setupStatus =
    !enabled
      ? "disabled"
      : preset.setupKind === "native" || preset.setupKind === "custom" || preset.setupKind === "markdown-zettelkasten"
        ? "complete"
        : "external-runtime-needed";

  const normalized: NormalizedPersonalAgentSubsystemConfig = {
    enabled,
    presetId,
    label: presetId === "custom" && customName ? customName : preset.label,
    stack: presetId === "custom" && customName ? customName : preset.stack,
    brain: preset.brain,
    summary: preset.summary,
    setupKind: preset.setupKind,
    advancedMode,
    features,
    enabledFeatures,
    setupSteps: preset.setupSteps,
    setupStatus,
    toolApprovalPolicy,
    soulPromptConfigured,
    launchBriefConfigured
  };

  if (customName) normalized.customName = customName;
  if (soulPrompt) normalized.soulPrompt = soulPrompt;
  if (launchBrief) normalized.launchBrief = launchBrief;
  if (externalEndpoint) normalized.externalEndpoint = externalEndpoint;
  if (preset.sourceLabel) normalized.sourceLabel = preset.sourceLabel;
  if (preset.sourceUrl) normalized.sourceUrl = preset.sourceUrl;

  return normalized;
}

export function publicPersonalAgentConfig(
  config: NormalizedPersonalAgentSubsystemConfig
): Omit<NormalizedPersonalAgentSubsystemConfig, "soulPrompt" | "launchBrief"> & {
  soulPromptConfigured: boolean;
  launchBriefConfigured: boolean;
} {
  const { soulPrompt: _soulPrompt, launchBrief: _launchBrief, ...rest } = config;
  return {
    ...rest,
    soulPromptConfigured: config.soulPromptConfigured,
    launchBriefConfigured: config.launchBriefConfigured,
    toolApprovalPolicy: config.toolApprovalPolicy
  };
}

export function personalAgentConfigBindingText(
  input?: PersonalAgentSubsystemConfig | null
): string {
  return JSON.stringify(normalizePersonalAgentConfig(input));
}

export function personalAgentPublicConfigBindingText(
  input?: PersonalAgentSubsystemConfig | null
): string {
  return JSON.stringify(publicPersonalAgentConfig(normalizePersonalAgentConfig(input)));
}

export function personalAgentSetupSql(
  input: PersonalAgentSubsystemConfig | undefined,
  deploymentId: string,
  createdAt = new Date().toISOString()
): string | undefined {
  const config = normalizePersonalAgentConfig(input);
  if (!config.enabled) return undefined;

  const publicConfig = publicPersonalAgentConfig(config);
  const setupRecord = {
    presetId: config.presetId,
    label: config.label,
    stack: config.stack,
    brain: config.brain,
    setupKind: config.setupKind,
    setupStatus: config.setupStatus,
    enabledFeatures: config.enabledFeatures,
    setupSteps: config.setupSteps,
    soulPromptConfigured: config.soulPromptConfigured,
    launchBriefConfigured: config.launchBriefConfigured,
    toolApprovalPolicy: config.toolApprovalPolicy,
    externalEndpoint: config.externalEndpoint ?? null
  };
  const memoryText = [
    `Personal agent setup selected ${config.label}.`,
    `Stack ${config.stack}. Brain ${config.brain}.`,
    `Enabled features ${config.enabledFeatures.join(", ") || "none"}.`,
    `MCP tool approval policy ${config.toolApprovalPolicy}.`,
    config.launchBriefConfigured
      ? "An initial launch brief is configured as the starting mission context."
      : "No initial launch brief is configured.",
    config.setupStatus === "external-runtime-needed"
      ? "OpenThink bootstrap is complete and an external runtime connection is still needed."
      : "OpenThink bootstrap is complete."
  ].join(" ");

  return [
    "create table if not exists personal_agent_setup (id text primary key, preset_id text not null, label text not null, stack text not null, brain text not null, setup_kind text not null, setup_status text not null, advanced_mode integer not null, config_json text not null, setup_steps_json text not null, created_at text not null, updated_at text not null)",
    "create table if not exists personal_agent_feature_flags (feature_key text primary key, enabled integer not null, updated_at text not null)",
    "create table if not exists memories (id text primary key, text text not null, created_at text not null)",
    [
      "insert or replace into personal_agent_setup (id, preset_id, label, stack, brain, setup_kind, setup_status, advanced_mode, config_json, setup_steps_json, created_at, updated_at) values (",
      sqlString("personal-agent"),
      ", ",
      sqlString(config.presetId),
      ", ",
      sqlString(config.label),
      ", ",
      sqlString(config.stack),
      ", ",
      sqlString(config.brain),
      ", ",
      sqlString(config.setupKind),
      ", ",
      sqlString(config.setupStatus),
      ", ",
      config.advancedMode ? "1" : "0",
      ", ",
      sqlString(JSON.stringify(publicConfig)),
      ", ",
      sqlString(JSON.stringify(setupRecord.setupSteps)),
      ", ",
      sqlString(createdAt),
      ", ",
      sqlString(createdAt),
      ")"
    ].join(""),
    ...personalAgentFeatureKeys.map((key) =>
      [
        "insert or replace into personal_agent_feature_flags (feature_key, enabled, updated_at) values (",
        sqlString(key),
        ", ",
        config.features[key] ? "1" : "0",
        ", ",
        sqlString(createdAt),
        ")"
      ].join("")
    ),
    [
      "insert or ignore into memories (id, text, created_at) values (",
      sqlString(`setup:${deploymentId}:personal-agent`),
      ", ",
      sqlString(memoryText),
      ", ",
      sqlString(createdAt),
      ")"
    ].join(""),
    ...(config.launchBrief
      ? [
          [
            "insert or replace into memories (id, text, created_at) values (",
            sqlString(`setup:${deploymentId}:launch-brief`),
            ", ",
            sqlString(`Initial launch brief for ${config.label}:\n${config.launchBrief}`),
            ", ",
            sqlString(createdAt),
            ")"
          ].join("")
        ]
      : [])
  ].join(";\n");
}

export function personalAgentSetupSeed(
  input?: PersonalAgentSubsystemConfig | null
): { config: NormalizedPersonalAgentSubsystemConfig; memoryText: string } {
  const config = normalizePersonalAgentConfig(input);
  return {
    config,
    memoryText: [
      `Personal agent setup selected ${config.label}.`,
      `Stack ${config.stack}. Brain ${config.brain}.`,
      `Enabled features ${config.enabledFeatures.join(", ") || "none"}.`,
      config.soulPromptConfigured
        ? "A custom soul prompt is configured."
        : "No custom soul prompt is configured.",
      config.launchBriefConfigured
        ? "An initial launch brief is configured."
        : "No initial launch brief is configured.",
      `MCP tool approval policy is ${config.toolApprovalPolicy}.`,
      config.setupStatus === "external-runtime-needed"
        ? "External runtime setup remains as an owner follow-up."
        : "Runtime setup is complete."
    ].join(" ")
  };
}

function trimBounded(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function sqlString(value: string): string {
  return `'${value.replace(/;/g, ",").replace(/'/g, "''")}'`;
}
