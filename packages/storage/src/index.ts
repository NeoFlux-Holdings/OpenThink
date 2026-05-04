import type { IStorageService } from "@open-think/core";

export interface R2BucketLike {
  put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
}

export class R2StorageService implements IStorageService {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(key: string, value: unknown): Promise<void> {
    await this.bucket.put(key, JSON.stringify(value));
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return JSON.parse(await object.text()) as T;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

export class InMemoryStorageService implements IStorageService {
  private readonly values = new Map<string, unknown>();

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}
