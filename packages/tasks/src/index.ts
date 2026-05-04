import type { ITaskQueue } from "@open-think/core";

export interface QueueLike<TPayload> {
  send(payload: TPayload): Promise<void>;
}

export class CloudflareQueue<TPayload = unknown> implements ITaskQueue<TPayload> {
  constructor(private readonly queue: QueueLike<TPayload>) {}

  async enqueue(payload: TPayload): Promise<void> {
    await this.queue.send(payload);
  }
}

export interface WorkflowDispatch<TPayload> {
  create(options: { id?: string; params: TPayload }): Promise<{ id: string }>;
}

export class WorkflowScheduler<TPayload = unknown> {
  constructor(private readonly workflow: WorkflowDispatch<TPayload>) {}

  async start(params: TPayload, id = crypto.randomUUID()): Promise<string> {
    const instance = await this.workflow.create({ id, params });
    return instance.id;
  }
}
