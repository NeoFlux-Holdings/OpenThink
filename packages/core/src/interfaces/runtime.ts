export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ILLMService {
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  stream(prompt: string, options?: GenerateOptions): AsyncIterable<string>;
}

export interface Vector {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean>;
}

export interface QueryOptions {
  topK?: number;
  namespace?: string;
  filter?: Record<string, string | number | boolean>;
}

export interface QueryResult {
  id: string;
  score: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface IVectorStore {
  upsert(vectors: Vector[]): Promise<void>;
  query(vector: number[], options?: QueryOptions): Promise<QueryResult[]>;
}

export interface IStorageService {
  put(key: string, value: unknown): Promise<void>;
  get<T = unknown>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
}

export interface ITerminalSession {
  start(command?: string[]): Promise<void>;
  write(data: string): Promise<void>;
  onOutput(callback: (data: string) => void): void;
  resize(cols: number, rows: number): Promise<void>;
  destroy(): Promise<void>;
}

export interface ITaskQueue<TPayload = unknown> {
  enqueue(payload: TPayload): Promise<void>;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface IMcpServer {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
}

export interface AgentMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
