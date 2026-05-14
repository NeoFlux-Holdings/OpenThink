import { readEnvString } from "./platform-env";

export const openThinkCanonicalRepository = "NeoFlux-Holdings/OpenThink";
export const openThinkCanonicalBranch = "main";
export const openThinkCanonicalBundlePath = "dist/worker.js";

export function readOpenThinkUpdateRepository(env: Record<string, unknown>): string {
  return readEnvString(env, "OPEN_THINK_UPDATE_REPOSITORY") ?? openThinkCanonicalRepository;
}

export function readOpenThinkUpdateBranch(
  env: Record<string, unknown>,
  fallback = openThinkCanonicalBranch
): string {
  return readEnvString(env, "OPEN_THINK_UPDATE_BRANCH") ?? fallback;
}

export function readOpenThinkUpdateBundlePath(env: Record<string, unknown>): string {
  return readEnvString(env, "OPEN_THINK_UPDATE_BUNDLE_PATH") ?? openThinkCanonicalBundlePath;
}
