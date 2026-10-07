import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { AiOrchestrator, MockAiProvider } from "@adaptive/ai";
import { loadConfig, type AppConfig } from "@adaptive/config";
import {
  authenticateSession,
  login,
  revokeSession,
  SESSION_TTL_MS,
} from "./auth.js";
import { createDatabasePool } from "./db/pool.js";
import { isValidLoginInput } from "./login-validation.js";
import { LoginRateLimiter } from "./login-rate-limit.js";
import { isJsonContentType } from "./request-content-type.js";

const ai = new AiOrchestrator(new MockAiProvider());
const MAX_BODY_BYTES = 16 * 1024;
class RequestInputError extends Error {
  constructor(
    readonly statusCode: 400 | 413,
    readonly errorCode: "invalid_request" | "payload_too_large",
  ) {
    super(errorCode);
    this.name = "RequestInputError";
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bodyBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bodyBytes += buffer.length;
    if (bodyBytes > MAX_BODY_BYTES) {
      throw new RequestInputError(413, "payload_too_large");
    }
    chunks.push(buffer);
  }

  let value: unknown;
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    value = body ? JSON.parse(body) : {};
  } catch {
    throw new RequestInputError(400, "invalid_request");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestInputError(400, "invalid_request");
  }
  return value as Record<string, unknown>;
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const pair = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : undefined;
}

function setSessionCookie(
  res: ServerResponse,
  token: string,
  config: AppConfig,
): void {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `ruhuka_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
}

function clearSessionCookie(res: ServerResponse, config: AppConfig): void {
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `ruhuka_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

export function isTrustedOrigin(
  origin: string | undefined,
  trustedOrigin: string,
): boolean {
  if (!origin) return false;
  try {
    const requestOrigin = new URL(origin);
    const configuredOrigin = new URL(trustedOrigin);
    const requestIsOrigin =
      origin === requestOrigin.origin || origin === `${requestOrigin.origin}/`;
    const configuredIsOrigin =
      trustedOrigin === configuredOrigin.origin ||
      trustedOrigin === `${configuredOrigin.origin}/`;
    return (
      requestIsOrigin &&
      configuredIsOrigin &&
      requestOrigin.origin === configuredOrigin.origin
    );
  } catch {
    return false;
  }
}

function safeRouteName(req: IncomingMessage): string {
  const pathname = req.url?.split("?", 1)[0];
  if (
    pathname === "/health" ||
    pathname === "/v1/auth/login" ||
    pathname === "/v1/auth/logout" ||
    pathname === "/v1/auth/session" ||
    pathname === "/v1/ai/sessions/demo/messages"
  ) {
    return pathname;
  }
  return "unmatched";
}

function logInternalError(req: IncomingMessage, error: unknown): void {
  const errorClass =
    error instanceof Error ? error.constructor.name : typeof error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  console.error(
    "API request failed",
    JSON.stringify({
      event: "request_failed",
      method: req.method ?? "unknown",
      route: safeRouteName(req),
      errorClass,
      ...(typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
        ? { databaseCode: code }
        : {}),
    }),
  );
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool,
  config: AppConfig,
  loginLimiter: LoginRateLimiter,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { status: "ok", service: "api" });
    return;
  }

  if (
    req.method === "POST" &&
    (req.url === "/v1/auth/login" || req.url === "/v1/auth/logout")
  ) {
    if (!isTrustedOrigin(req.headers.origin, config.corsOrigin)) {
      json(res, 403, { error: "forbidden" });
      return;
    }
    if (!isJsonContentType(req.headers["content-type"])) {
      json(res, 415, { error: "unsupported_media_type" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/v1/auth/login") {
    const key = req.socket.remoteAddress ?? "unknown";
    if (!loginLimiter.allow(key)) {
      json(res, 429, { error: "rate_limited" });
      return;
    }
    const body = await readJson(req);
    if (
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      !isValidLoginInput(body.email, body.password)
    ) {
      json(res, 400, { error: "invalid_request" });
      return;
    }
    const session = await login(pool, body.email, body.password);
    if (!session) {
      json(res, 401, { error: "invalid_credentials" });
      return;
    }
    setSessionCookie(res, session.token, config);
    json(res, 200, { expiresAt: session.expiresAt.toISOString() });
    return;
  }

  if (req.method === "POST" && req.url === "/v1/auth/logout") {
    await revokeSession(pool, cookieValue(req, "ruhuka_session"));
    clearSessionCookie(res, config);
    json(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "GET" && req.url === "/v1/auth/session") {
    const user = await authenticateSession(
      pool,
      cookieValue(req, "ruhuka_session"),
    );
    if (!user) {
      json(res, 401, { error: "unauthenticated" });
      return;
    }
    json(res, 200, { userId: user.userId });
    return;
  }

  if (req.method === "POST" && req.url === "/v1/ai/sessions/demo/messages") {
    if (config.nodeEnv === "production") {
      json(res, 404, { error: "not_found" });
      return;
    }
    const parsed = await readJson(req);
    const result = await ai.generate({
      role: "client",
      messages: [{ role: "user", content: String(parsed.message ?? "") }],
    });
    json(res, 200, result);
    return;
  }

  json(res, 404, { error: "not_found" });
}

export function createApiServer(pool: Pool, config: AppConfig = loadConfig()) {
  const loginLimiter = new LoginRateLimiter();
  return createServer((req, res) => {
    void handleRequest(req, res, pool, config, loginLimiter)
      .catch((error: unknown) => {
        try {
          if (error instanceof RequestInputError) {
            if (error.statusCode === 413) res.setHeader("Connection", "close");
            json(res, error.statusCode, { error: error.errorCode });
            return;
          }
          logInternalError(req, error);
          if (!res.headersSent) {
            json(res, 500, { error: "internal_error" });
          } else {
            res.destroy();
          }
        } catch {
          res.destroy();
        }
      })
      .catch(() => {
        res.destroy();
      });
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl);
  createApiServer(pool, config).listen(config.apiPort, () => {
    console.log(`Adaptive API listening on http://localhost:${config.apiPort}`);
  });
}
