import { ChatStateRepository } from "@open-think/state";

const globalChatStore = globalThis as typeof globalThis & {
  __openThinkChatState?: ChatStateRepository;
};

export function chatStateRepositoryFromEnv(): ChatStateRepository {
  if (!globalChatStore.__openThinkChatState) {
    globalChatStore.__openThinkChatState = new ChatStateRepository();
  }

  return globalChatStore.__openThinkChatState;
}
