import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { WorkersAIBinding } from "@open-think/llm";
import type { D1DatabaseLike } from "./d1";

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(request: Request | string, init?: RequestInit): Promise<Response>;
  };
}

export interface AssetBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface QueueBindingLike<T = unknown> {
  send(message: T): Promise<void>;
}

export interface PlatformRuntimeEnv extends Record<string, unknown> {
  AI?: WorkersAIBinding;
  DB?: D1DatabaseLike;
  CHAT_DO?: DurableObjectNamespaceLike;
  TERMINAL_DO?: DurableObjectNamespaceLike;
  AGENT_DO?: DurableObjectNamespaceLike;
  ASSETS?: AssetBindingLike;
  DEPLOYMENT_QUEUE?: QueueBindingLike;
}

export function getPlatformRuntimeEnv(): PlatformRuntimeEnv {
  const env: PlatformRuntimeEnv = { ...process.env };

  try {
    Object.assign(env, getCloudflareContext().env);
  } catch {
    // `next dev` can run before the OpenNext dev bridge has a request context.
  }

  return env;
}

export function readEnvString(
  env: Record<string, unknown>,
  key: string
): string | undefined {
  const value = env[key] ?? process.env[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
