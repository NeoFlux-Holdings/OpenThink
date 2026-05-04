import type { GenerateOptions, ILLMService } from "@open-think/core";

export interface WorkersAIBinding {
  run(model: string, input: unknown, options?: Record<string, unknown>): Promise<unknown>;
}

export class WorkersAIService implements ILLMService {
  constructor(
    private readonly ai: WorkersAIBinding,
    private readonly defaultModel = "@cf/meta/llama-3.1-8b-instruct"
  ) {}

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const output = await this.ai.run(options.model ?? this.defaultModel, {
      prompt,
      max_tokens: options.maxTokens,
      temperature: options.temperature
    });

    return unwrapText(output);
  }

  async *stream(prompt: string, options: GenerateOptions = {}): AsyncIterable<string> {
    yield await this.generate(prompt, options);
  }
}

export class AIGatewayService implements ILLMService {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly defaultModel: string
  ) {}

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature,
        max_tokens: options.maxTokens
      })
    };

    if (options.signal) init.signal = options.signal;

    const response = await fetch(this.endpoint, init);

    if (!response.ok) {
      throw new Error(`AI Gateway request failed with ${response.status}`);
    }

    return unwrapText(await response.json());
  }

  async *stream(prompt: string, options: GenerateOptions = {}): AsyncIterable<string> {
    yield await this.generate(prompt, options);
  }
}

function unwrapText(output: unknown): string {
  if (typeof output === "string") return output;

  if (isRecord(output)) {
    const response = output.response ?? output.result ?? output.text;
    if (typeof response === "string") return response;

    const choices = output.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0];
      if (isRecord(first)) {
        const message = first.message;
        if (isRecord(message) && typeof message.content === "string") {
          return message.content;
        }
      }
    }
  }

  return JSON.stringify(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
