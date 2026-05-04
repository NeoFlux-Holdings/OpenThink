"use client";

import { Bot, Building2, Cloud, CreditCard, GitBranch, UserRoundCheck } from "lucide-react";
import { deploymentFlows } from "@/lib/platform";
import type { DeploymentFlow } from "@/lib/deployment-engine";

const icons = {
  self: UserRoundCheck,
  stripe: CreditCard,
  button: GitBranch,
  agent: Bot,
  partner: Building2
} satisfies Record<DeploymentFlow, typeof Cloud>;

interface FlowSelectorProps {
  value: DeploymentFlow;
  onChange: (flow: DeploymentFlow) => void;
}

export function FlowSelector({ value, onChange }: FlowSelectorProps) {
  return (
    <div className="flow-selector" role="listbox" aria-label="Deployment pathways">
      {deploymentFlows.map((flow) => {
        const Icon = icons[flow.id];

        return (
          <button
            key={flow.id}
            className="flow-card"
            type="button"
            role="option"
            aria-selected={flow.id === value}
            data-active={flow.id === value}
            onClick={() => onChange(flow.id)}
          >
            <span className="flow-card-top">
              <span>
                <span className="eyebrow">{flow.eyebrow}</span>
                <h3>{flow.label}</h3>
              </span>
              <Icon size={20} aria-hidden="true" />
            </span>
            <p>{flow.summary}</p>
            <span className="operator">{flow.operator}</span>
          </button>
        );
      })}
    </div>
  );
}
