import { authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getPlatformRuntimeEnv, readEnvString } from "@/lib/platform-env";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireAuthenticatedUser(request);
    const env = getPlatformRuntimeEnv();
    const response = await terminalDoFetch(user.id, new Request("https://terminal.open-think.internal/"), env);
    return response;
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json(
      { error: error instanceof Error ? error.message : "Terminal status failed." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireAuthenticatedUser(request);
    const payload = (await request.json().catch(() => ({}))) as { command?: string };
    const command = payload.command?.trim() || "status";
    const env = getPlatformRuntimeEnv();

    if (command === "start") {
      return terminalDoFetch(
        user.id,
        new Request("https://terminal.open-think.internal/start", { method: "POST" }),
        env
      );
    }

    const startResponse = await terminalDoFetch(
      user.id,
      new Request("https://terminal.open-think.internal/start", { method: "POST" }),
      env
    );
    if (!startResponse.ok && startResponse.status !== 409) {
      return startResponse;
    }

    const writeResponse = await terminalDoFetch(
      user.id,
      new Request("https://terminal.open-think.internal/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: `${command}\n` })
      }),
      env
    );
    if (!writeResponse.ok) return writeResponse;

    return Response.json({
      id: crypto.randomUUID(),
      command,
      output: `forwarded to TerminalDO PTY for ${user.id}`,
      terminal: await writeResponse.json()
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}

async function terminalDoFetch(
  userId: string,
  request: Request,
  env: ReturnType<typeof getPlatformRuntimeEnv>
): Promise<Response> {
  if (!env.TERMINAL_DO) {
    return Response.json(
      { error: "TERMINAL_DO binding is required for browser terminal sessions." },
      { status: 503 }
    );
  }

  const id = env.TERMINAL_DO.idFromName(userId);
  const stub = env.TERMINAL_DO.get(id);
  const response = await stub.fetch(request);

  if (response.ok || request.method !== "GET") {
    return response;
  }

  return Response.json(
    {
      websocket: "/terminal",
      durableObject: "TerminalDO",
      transport: "websocket-pty",
      localCommand: `cloudflared access ssh --hostname personal-agent.${
        readEnvString(env, "NEXT_PUBLIC_PLATFORM_HOST") ?? "beta2.open-think.app"
      }`
    },
    { status: response.status }
  );
}
