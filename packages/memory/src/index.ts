import type { AgentMessage, IStorageService } from "@open-think/core";

export interface MemoryFact {
  id: string;
  userId: string;
  text: string;
  confidence: number;
  createdAt: string;
}

export class AgentMemoryService {
  constructor(private readonly storage: IStorageService) {}

  async remember(userId: string, text: string, confidence = 0.75): Promise<MemoryFact> {
    const fact: MemoryFact = {
      id: crypto.randomUUID(),
      userId,
      text,
      confidence,
      createdAt: new Date().toISOString()
    };

    await this.storage.put(`memory:${userId}:${fact.id}`, fact);
    return fact;
  }

  async extractFromMessage(userId: string, message: AgentMessage): Promise<MemoryFact | null> {
    if (message.role !== "user" || message.content.length < 24) return null;
    return this.remember(userId, message.content, 0.62);
  }
}
