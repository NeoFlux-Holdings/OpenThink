import { getPlatformRuntimeEnv, readEnvString } from "./platform-env";

export interface AuthenticatedUser {
  id: string;
  email?: string;
  source: "cloudflare-access" | "jwt" | "dev";
}

export class AuthError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "Administrator access required.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function requireAuthenticatedUser(
  request: Request
): Promise<AuthenticatedUser> {
  const accessEmail = request.headers.get("cf-access-authenticated-user-email");
  const accessSubject =
    request.headers.get("cf-access-user-id") ??
    request.headers.get("cf-access-jwt-assertion");

  if (accessEmail || accessSubject) {
    const user: AuthenticatedUser = {
      id: stableUserId(accessEmail ?? accessSubject ?? "access-user"),
      source: "cloudflare-access"
    };
    if (accessEmail) user.email = accessEmail;
    return user;
  }

  const bearer = parseBearerToken(request.headers.get("authorization"));
  if (bearer) {
    const jwtUser = await verifyJwtUser(bearer);
    if (jwtUser) return jwtUser;
  }

  if (allowDevAutoAuth()) {
    return {
      id: "local-dev-user",
      email: "local-dev@open-think.local",
      source: "dev"
    };
  }

  throw new AuthError();
}

export function authErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message }, { status: 403 });
  }

  if (!(error instanceof AuthError)) return null;

  return Response.json(
    {
      error: error.message
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": "Bearer"
      }
    }
  );
}

export async function requireAdminUser(request: Request): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser(request);
  const env = getPlatformRuntimeEnv();
  const adminEmails = new Set(
    (readEnvString(env, "OPEN_THINK_ADMIN_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

  if (user.email && adminEmails.has(user.email.toLowerCase())) {
    return user;
  }

  if (process.env.NODE_ENV !== "production" && readEnvString(env, "OPEN_THINK_DEV_ADMIN") === "true") {
    return user;
  }

  throw new AuthorizationError();
}

function parseBearerToken(value: string | null): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function verifyJwtUser(token: string): Promise<AuthenticatedUser | null> {
  const secret = process.env.OPEN_THINK_JWT_SECRET;
  if (!secret) return null;

  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;

  const parsedHeader = parseJsonPart<{ alg?: string }>(header);
  if (parsedHeader?.alg !== "HS256") return null;

  const expected = await signHs256(`${header}.${payload}`, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  const claims = parseJsonPart<{
    sub?: string;
    email?: string;
    exp?: number;
  }>(payload);
  if (!claims?.sub) return null;

  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new AuthError("JWT expired.");
  }

  const user: AuthenticatedUser = {
    id: stableUserId(claims.sub),
    source: "jwt"
  };
  if (claims.email) user.email = claims.email;
  return user;
}

async function signHs256(input: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(input));
  return base64UrlEncode(new Uint8Array(signature));
}

function parseJsonPart<T>(part: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as T;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

function stableUserId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function allowDevAutoAuth(): boolean {
  const env = getPlatformRuntimeEnv();
  return process.env.NODE_ENV !== "production" && readEnvString(env, "OPEN_THINK_DEV_AUTO_AUTH") === "true";
}
