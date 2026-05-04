export interface WranglerBindingPlan {
  name: string;
  starter: "personal-agent";
  accountId?: string;
}

export function generateWrangler(plan: WranglerBindingPlan) {
  return {
    name: plan.name,
    compatibility_date: "2026-05-01",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    ai: { binding: "AI" },
    durable_objects: {
      bindings: [
        { name: "AGENT_DO", class_name: "AgentDO" },
        { name: "CHAT_DO", class_name: "ChatDO" },
        { name: "TERMINAL_DO", class_name: "TerminalDO" }
      ]
    },
    r2_buckets: [{ binding: "AGENT_STORAGE", bucket_name: `${plan.name}-artifacts` }],
    d1_databases: [{ binding: "DB", database_name: `${plan.name}-db` }],
    vectorize: [{ binding: "VECTORIZE", index_name: `${plan.name}-memory` }],
    queues: {
      producers: [{ binding: "TASK_QUEUE", queue: `${plan.name}-tasks` }]
    },
    vars: {
      OPEN_THINK_STARTER: plan.starter
    }
  };
}
