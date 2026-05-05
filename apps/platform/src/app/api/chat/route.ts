import { authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { ModelConfigurationError } from "@/lib/model-router";
import { getPlatformRuntimeEnv, readEnvString } from "@/lib/platform-env";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.searchParams.get("history") === "1") {
    try {
      const user = await requireAuthenticatedUser(request);
      const env = getPlatformRuntimeEnv();

      if (!env.CHAT_DO) {
        return Response.json(
          { error: "CHAT_DO binding is required for persisted chat." },
          { status: 503 }
        );
      }

      const id = env.CHAT_DO.idFromName(user.id);
      const stub = env.CHAT_DO.get(id);
      return stub.fetch(
        new Request(
          `https://chat.open-think.internal/?conversationId=${encodeURIComponent(user.id)}`,
          { method: "GET" }
        )
      );
    } catch (error) {
      const authResponse = authErrorResponse(error);
      if (authResponse) return authResponse;
      throw error;
    }
  }

  return Response.json({
    endpoint: "/api/chat",
    transports: {
      sse: "/api/chat",
      agentsSdkWebSocket: "/agents/personal-chat-agent/default"
    },
    history: "/api/chat?history=1",
    clearHistory: "DELETE /api/chat",
    durableObject: "ChatDO",
    persistence: "SQLite",
    streaming: "server-sent-events",
    nativeAgentsRuntime: "AIChatAgent/useAgentChat"
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireAuthenticatedUser(request);
    const payload = (await request.json().catch(() => ({}))) as {
      message?: string;
      stream?: boolean;
    };
    const message = payload.message?.trim() || "Plan the next Cloudflare-native agent step.";
    const env = getPlatformRuntimeEnv();
    const wantsStream =
      payload.stream === true ||
      request.headers.get("accept")?.toLowerCase().includes("text/event-stream") === true;

    if (!env.CHAT_DO) {
      return Response.json(
        { error: "CHAT_DO binding is required for persisted chat." },
        { status: 503 }
      );
    }

    const id = env.CHAT_DO.idFromName(user.id);
    const stub = env.CHAT_DO.get(id);
    const durableResponse = await stub.fetch(
      new Request(
        `https://chat.open-think.internal/?conversationId=${encodeURIComponent(user.id)}${
          wantsStream ? "&stream=1" : ""
        }`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(wantsStream ? { Accept: "text/event-stream" } : {})
          },
          body: JSON.stringify({ message, userId: user.id })
        }
      )
    );

    if (wantsStream) {
      return durableResponse;
    }

    if (!durableResponse.ok) {
      return durableResponse;
    }

    const payloadFromDo = (await durableResponse.json()) as {
      message: {
        id: string;
        role: "assistant";
        content: string;
      };
    };
    const assistantMessage = payloadFromDo.message;

    return Response.json({
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      toolState: {
        workersAI: env.AI ? "ready" : "unbound",
        aiGateway:
          readEnvString(env, "AI_GATEWAY_ENDPOINT") && readEnvString(env, "AI_GATEWAY_API_KEY")
            ? "active"
            : "unconfigured",
        mcp: "attached",
        persistence: "ChatDO SQLite"
      }
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof ModelConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const user = await requireAuthenticatedUser(request);
    const env = getPlatformRuntimeEnv();

    if (!env.CHAT_DO) {
      return Response.json(
        { error: "CHAT_DO binding is required for persisted chat." },
        { status: 503 }
      );
    }

    const id = env.CHAT_DO.idFromName(user.id);
    const stub = env.CHAT_DO.get(id);
    return stub.fetch(
      new Request(
        `https://chat.open-think.internal/?conversationId=${encodeURIComponent(user.id)}`,
        { method: "DELETE" }
      )
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
