import type {
  IVectorStore,
  QueryOptions,
  QueryResult,
  Vector
} from "@open-think/core";

export interface VectorizeIndexLike {
  upsert(vectors: Vector[]): Promise<void>;
  query(values: number[], options?: QueryOptions): Promise<{ matches: QueryResult[] }>;
}

export class VectorizeStore implements IVectorStore {
  constructor(private readonly index: VectorizeIndexLike) {}

  async upsert(vectors: Vector[]): Promise<void> {
    await this.index.upsert(vectors);
  }

  async query(vector: number[], options?: QueryOptions): Promise<QueryResult[]> {
    const result = await this.index.query(vector, options);
    return result.matches;
  }
}

export interface AutoRAGSearchResult {
  id: string;
  text: string;
  score: number;
  source?: string;
}

export class AutoRAGRetriever {
  constructor(private readonly endpoint: string, private readonly token: string) {}

  async search(query: string): Promise<AutoRAGSearchResult[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      throw new Error(`AutoRAG search failed with ${response.status}`);
    }

    const body = (await response.json()) as { results?: AutoRAGSearchResult[] };
    return body.results ?? [];
  }
}
