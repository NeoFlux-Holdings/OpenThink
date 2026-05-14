import {
  DeploymentEngine,
  DeploymentProvisioningError,
  DeploymentValidationError,
  type DeploymentQueueMessage
} from "./deployment-engine";
import type { D1DatabaseLike } from "./d1";
import { readEnvString, type QueueBindingLike } from "./platform-env";
import { resolveDeploymentRepository } from "./repositories";

export type { DeploymentQueueMessage };

export interface DeploymentQueueConsumerMessage {
  body: unknown;
  ack?(): void;
  retry?(options?: { delaySeconds?: number }): void;
}

export interface DeploymentQueueBatch {
  messages: DeploymentQueueConsumerMessage[];
  queue?: string;
}

export function isDeploymentQueueBinding(
  value: unknown
): value is QueueBindingLike<DeploymentQueueMessage> {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { send?: unknown }).send === "function"
  );
}

export function parseDeploymentQueueMessage(value: unknown): DeploymentQueueMessage {
  if (!value || typeof value !== "object") {
    throw new DeploymentValidationError("Deployment queue message must be an object.");
  }

  const message = value as Partial<DeploymentQueueMessage>;
  if (message.version !== 1) {
    throw new DeploymentValidationError("Unsupported deployment queue message version.");
  }

  if (!message.deploymentId?.trim()) {
    throw new DeploymentValidationError("Deployment queue message is missing deploymentId.");
  }

  if (!message.request || typeof message.request !== "object") {
    throw new DeploymentValidationError("Deployment queue message is missing request.");
  }

  return message as DeploymentQueueMessage;
}

export async function consumeDeploymentQueue(
  batch: DeploymentQueueBatch,
  env: Record<string, unknown>
): Promise<void> {
  const db = isD1DatabaseLike(env.DB) ? env.DB : undefined;
  const repository = resolveDeploymentRepository(db ? { DB: db } : {}, env);

  for (const message of batch.messages) {
    try {
      const queueMessage = parseDeploymentQueueMessage(message.body);
      await new DeploymentEngine({
        platformHost: readEnvString(env, "NEXT_PUBLIC_PLATFORM_HOST") ?? "beta2.open-think.app",
        env,
        workersAIAvailable: Boolean(env.AI),
        repository: repository.repository,
        repositoryKind: repository.kind
      }).runQueuedDeployment(queueMessage);
      message.ack?.();
    } catch (error) {
      if (error instanceof DeploymentProvisioningError || error instanceof DeploymentValidationError) {
        message.ack?.();
        console.error("[deployment-queue] Deployment job failed", error);
        continue;
      }

      console.error("[deployment-queue] Retrying deployment job", error);
      message.retry?.({ delaySeconds: 30 });
    }
  }
}

function isD1DatabaseLike(value: unknown): value is D1DatabaseLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { prepare?: unknown }).prepare === "function"
  );
}
