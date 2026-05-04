import { describe, expect, it } from "vitest";
import { BaseAgent, type ILLMService } from "../index";

const llm: ILLMService = {
  async generate(prompt) {
    return `handled: ${prompt}`;
  },
  async *stream(prompt) {
    yield prompt;
  }
};

describe("BaseAgent", () => {
  it("generates and returns an assistant message", async () => {
    const agent = new BaseAgent({ llm });
    const message = await agent.run({
      conversationId: "test",
      prompt: "deploy"
    });

    expect(message.role).toBe("assistant");
    expect(message.content).toContain("deploy");
  });
});
