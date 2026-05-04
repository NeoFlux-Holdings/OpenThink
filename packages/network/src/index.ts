export interface AgentRegistration {
  id: string;
  url: string;
  capabilities: string[];
  region?: string;
  updatedAt: string;
}

export class Registrar {
  private readonly registrations = new Map<string, AgentRegistration>();

  async register(input: Omit<AgentRegistration, "updatedAt">): Promise<AgentRegistration> {
    const registration: AgentRegistration = {
      ...input,
      updatedAt: new Date().toISOString()
    };

    this.registrations.set(input.id, registration);
    return registration;
  }

  async resolve(id: string): Promise<AgentRegistration | null> {
    return this.registrations.get(id) ?? null;
  }

  async list(): Promise<AgentRegistration[]> {
    return [...this.registrations.values()];
  }
}
