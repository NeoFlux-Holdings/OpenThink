import type { AgentMessage } from "@open-think/core";

export interface DurableObjectRecord<T = unknown> {
  id: string;
  value: T;
  updatedAt: string;
}

export class InMemoryDurableObjectStore {
  private readonly records = new Map<string, DurableObjectRecord>();

  async put<T>(id: string, value: T): Promise<DurableObjectRecord<T>> {
    const record: DurableObjectRecord<T> = {
      id,
      value,
      updatedAt: new Date().toISOString()
    };

    this.records.set(id, record);
    return record;
  }

  async get<T>(id: string): Promise<DurableObjectRecord<T> | null> {
    return (this.records.get(id) as DurableObjectRecord<T> | undefined) ?? null;
  }

  async list(prefix = ""): Promise<DurableObjectRecord[]> {
    return [...this.records.values()].filter((record) => record.id.startsWith(prefix));
  }
}

export class ChatStateRepository {
  constructor(private readonly store = new InMemoryDurableObjectStore()) {}

  async append(conversationId: string, message: AgentMessage): Promise<void> {
    await this.store.put(
      `conversation:${conversationId}:message:${message.id}`,
      message
    );
  }

  async messages(conversationId: string): Promise<AgentMessage[]> {
    const records = await this.store.list(`conversation:${conversationId}:message:`);
    return records
      .map((record) => record.value as AgentMessage)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
