import { AIGatewayService, type WorkersAIBinding, WorkersAIService } from "@open-think/llm";
import type { ILLMService } from "@open-think/core";
import { readEnvString } from "./platform-env";

export interface ModelRouterOptions {
  workersAI?: WorkersAIBinding;
  env?: Record<string, unknown>;
}

export class ModelConfigurationError extends Error {
  constructor(message = "Configure Workers AI binding or AI Gateway before using chat.") {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

export function modelServiceFromEnv(options: ModelRouterOptions = {}): ILLMService {
  const env = options.env ?? process.env;
  const defaultModel =
    readEnvString(env, "OPEN_THINK_DEFAULT_MODEL") ?? "@cf/moonshotai/kimi-k2.6";

  if (options.workersAI) {
    return new WorkersAIService(options.workersAI, defaultModel);
  }

  const gatewayEndpoint = readEnvString(env, "AI_GATEWAY_ENDPOINT");
  const gatewayKey = readEnvString(env, "AI_GATEWAY_API_KEY");

  if (gatewayEndpoint && gatewayKey) {
    return new AIGatewayService(gatewayEndpoint, gatewayKey, defaultModel);
  }

  throw new ModelConfigurationError();
}

export async function generateAgentReply(input: {
  userId: string;
  message: string;
  model?: ILLMService;
  workersAI?: WorkersAIBinding;
  env?: Record<string, unknown>;
}): Promise<string> {
  const modelOptions: ModelRouterOptions = {};
  if (input.workersAI) modelOptions.workersAI = input.workersAI;
  if (input.env) modelOptions.env = input.env;
  const model = input.model ?? modelServiceFromEnv(modelOptions);
  const system = [
    "You are the open-think control plane agent.",
    "Prefer fully automated Cloudflare-native actions.",
    "Route chat through ChatDO, persistence through SQLite/D1, tools through MCP, and execution through Containers.",
    `Authenticated user: ${input.userId}.`
  ].join("\n");

  return model.generate(`${system}\n\nUser request:\n${input.message}`, {
    temperature: 0.2,
    maxTokens: 450,
    metadata: {
      userId: input.userId,
      surface: "chat"
    }
  });
}
