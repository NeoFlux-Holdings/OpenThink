import {
  D1HttpDatabase,
  D1DeploymentRepository,
  InMemoryDeploymentRepository,
  type D1DatabaseLike,
  type DeploymentRepository
} from "./d1";
import type { RepositoryKind } from "./environment";
import { readEnvString } from "./platform-env";

const globalRepositories = globalThis as typeof globalThis & {
  __openThinkDeploymentRepository?: DeploymentRepository;
  DB?: D1DatabaseLike;
};

export interface RepositoryResolution {
  repository: DeploymentRepository;
  kind: RepositoryKind;
}

export interface PlatformBindings {
  DB?: D1DatabaseLike;
}

export function resolveDeploymentRepository(
  bindings: PlatformBindings = {},
  env: Record<string, unknown> = process.env
): RepositoryResolution {
  const db = bindings.DB ?? globalRepositories.DB;

  if (db) {
    return {
      repository: new D1DeploymentRepository(db),
      kind: "d1"
    };
  }

  const accountId = readEnvString(env, "CLOUDFLARE_ACCOUNT_ID");
  const apiToken = readEnvString(env, "CLOUDFLARE_API_TOKEN");
  const databaseId = readEnvString(env, "OPEN_THINK_PLATFORM_D1_DATABASE_ID");

  if (accountId && apiToken && databaseId) {
    return {
      repository: new D1DeploymentRepository(
        new D1HttpDatabase({
          accountId,
          apiToken,
          databaseId
        })
      ),
      kind: "d1-rest"
    };
  }

  if (!globalRepositories.__openThinkDeploymentRepository) {
    globalRepositories.__openThinkDeploymentRepository =
      new InMemoryDeploymentRepository();
  }

  return {
    repository: globalRepositories.__openThinkDeploymentRepository,
    kind: "memory"
  };
}

export function deploymentRepositoryFromEnv(
  bindings: PlatformBindings = {},
  env: Record<string, unknown> = process.env
): DeploymentRepository {
  return resolveDeploymentRepository(bindings, env).repository;
}
