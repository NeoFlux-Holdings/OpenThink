declare module "@isomorphic-git/lightning-fs" {
  export default class LightningFS {
    constructor(name: string);
    promises: {
      mkdir(path: string): Promise<void>;
      readdir(path: string): Promise<string[]>;
      readFile(path: string, options?: { encoding?: string }): Promise<string | Uint8Array>;
      writeFile(path: string, data: string | Uint8Array, options?: { encoding?: string }): Promise<void>;
      stat(path: string): Promise<{ isDirectory(): boolean }>;
    };
  }
}
