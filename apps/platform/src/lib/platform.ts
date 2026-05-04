import type { DeploymentFlow, StarterTemplate } from "./deployment-engine";

export const platformHost =
  process.env.NEXT_PUBLIC_PLATFORM_HOST ?? "beta2.open-think.app";

export const starterTemplates: Array<{
  id: StarterTemplate;
  label: string;
  summary: string;
  services: string[];
}> = [
  {
    id: "personal-agent",
    label: "Personal Agent",
    summary: "One agent with chat, coding workspace hooks, messaging tools, memory, files, tasks, and terminal handoff.",
    services: ["Worker", "AI", "D1", "R2", "Vectorize", "Queue", "MCP"]
  }
];

export const deploymentFlows: Array<{
  id: DeploymentFlow;
  label: string;
  eyebrow: string;
  summary: string;
  operator: string;
}> = [
  {
    id: "self",
    label: "Launch my agent",
    eyebrow: "User owned",
    summary: "Deploy one all-in-one personal agent into your own Cloudflare account with a scoped token.",
    operator: "Best for public self-service users"
  },
  {
    id: "stripe",
    label: "Deploy with Stripe",
    eyebrow: "Zero touch",
    summary: "Create billing, account, spend limit, and first agent without a terminal.",
    operator: "Best for non-technical owners"
  },
  {
    id: "button",
    label: "Deploy to Cloudflare",
    eyebrow: "GitHub OAuth",
    summary: "Fork the starter, configure Actions, and deploy from a repository.",
    operator: "Best for builders with GitHub"
  },
  {
    id: "agent",
    label: "Agentic Provisioning",
    eyebrow: "MCP handoff",
    summary: "Give a coding agent a scoped prompt and Cloudflare MCP surface.",
    operator: "Best for AI-assisted teams"
  },
  {
    id: "partner",
    label: "Partner API",
    eyebrow: "White label",
    summary: "Provision under a formal partner account and own the tenant UX.",
    operator: "Best for platform partners"
  }
];
