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
import {
  auditAuthorizationDecision,
  requirePermission,
} from "./authorization.js";
import { createDatabasePool } from "./db/pool.js";
import { isValidLoginInput } from "./login-validation.js";
import { LoginRateLimiter } from "./login-rate-limit.js";
import { isJsonContentType } from "./request-content-type.js";
import {
  configurationRoutes,
  configureOrganization,
  isPermissionKey,
  isUuid,
} from "./organization-config.js";

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

function sessionCookieAttributes(config: AppConfig): string {
  // Host-only cookies (no Domain) work through the public reverse proxy.
  // Do not derive security settings from untrusted forwarded request headers.
  const secure =
    config.nodeEnv === "production" ||
    new URL(config.corsOrigin).protocol === "https:";
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function setSessionCookie(
  res: ServerResponse,
  token: string,
  config: AppConfig,
): void {
  res.setHeader(
    "Set-Cookie",
    `ruhuka_session=${token}; ${sessionCookieAttributes(config)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
}

function clearSessionCookie(res: ServerResponse, config: AppConfig): void {
  res.setHeader(
    "Set-Cookie",
    `ruhuka_session=; ${sessionCookieAttributes(config)}; Max-Age=0`,
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
      ["http:", "https:"].includes(requestOrigin.protocol) &&
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
    pathname === "/v1/users/me" ||
    pathname === "/v1/ai/sessions/demo/messages" ||
    pathname === "/v1/org/permissions/check" ||
    (pathname !== undefined && configurationRoutes.has(pathname))
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
        ? { databaseCode: code, errorMessage: error.message }
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
  // Same-origin GETs may omit Origin. Browser mutations still require the
  // configured public origin; Host/X-Forwarded-* never establish trust.
  res.setHeader("Vary", "Origin");
  if (req.headers.origin) {
    if (!isTrustedOrigin(req.headers.origin, config.corsOrigin)) {
      json(res, 403, { error: "forbidden" });
      return;
    }
    res.setHeader(
      "Access-Control-Allow-Origin",
      new URL(config.corsOrigin).origin,
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") {
    const method = req.headers["access-control-request-method"];
    const headers = req.headers["access-control-request-headers"];
    const allowedHeaders = new Set(["content-type", "x-organization-id"]);
    if (
      !isTrustedOrigin(req.headers.origin, config.corsOrigin) ||
      typeof method !== "string" ||
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ||
      (typeof headers === "string" &&
        headers
          .split(",")
          .some((header) => !allowedHeaders.has(header.trim().toLowerCase())))
    ) {
      json(res, 403, { error: "forbidden" });
      return;
    }
    res.setHeader(
      "Vary",
      "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Organization-Id",
    );
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { status: "ok", service: "api" });
    return;
  }

  if (
    req.method === "POST" &&
    (req.url === "/v1/auth/login" ||
      req.url === "/v1/auth/logout" ||
      configurationRoutes.has(req.url ?? ""))
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

  if (req.method === "GET" && req.url === "/v1/users/me") {
    const user = await authenticateSession(
      pool,
      cookieValue(req, "ruhuka_session"),
    );
    if (!user) {
      json(res, 401, { error: "unauthenticated" });
      return;
    }
    const organizationId = req.headers["x-organization-id"];
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      json(res, 400, { error: "invalid_request" });
      return;
    }

    const decision = await requirePermission(pool, {
      userId: user.userId,
      organizationId,
      permission: "user.read",
    });

    await auditAuthorizationDecision(
      pool,
      {
        userId: user.userId,
        organizationId,
        permission: "user.read",
        resource: "user_profile",
        scope: decision.granted ? decision.scopes.join(",") : undefined,
        decision: decision.granted ? "granted" : "denied",
        reason: decision.granted ? undefined : decision.reason,
        route: "/v1/users/me",
      },
      false,
    );

    if (!decision.granted || !decision.scopes.includes("own_user")) {
      console.error(
        "API authorization denied",
        JSON.stringify({
          event: "authorization_denied",
          route: "/v1/users/me",
          reason: decision.granted ? "scope_not_granted" : decision.reason,
        }),
      );
      json(res, 403, { error: "forbidden" });
      return;
    }

    const profile = await pool.query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE id = $1",
      [user.userId],
    );
    const row = profile.rows[0];
    if (!row) {
      json(res, 404, { error: "not_found" });
      return;
    }
    json(res, 200, { userId: row.id, email: row.email });
    return;
  }

  if (
    (req.method === "POST" && configurationRoutes.has(req.url ?? "")) ||
    (req.method === "GET" &&
      req.url?.split("?", 1)[0] === "/v1/org/permissions/check")
  ) {
    const user = await authenticateSession(
      pool,
      cookieValue(req, "ruhuka_session"),
    );
    if (!user) {
      json(res, 401, { error: "unauthenticated" });
      return;
    }
    const organizationId = req.headers["x-organization-id"];
    if (!isUuid(organizationId)) {
      json(res, 400, { error: "invalid_request" });
      return;
    }
    if (req.method === "GET") {
      const permission = new URL(
        req.url!,
        "http://api.internal",
      ).searchParams.get("permission");
      if (!isPermissionKey(permission)) {
        json(res, 400, { error: "invalid_request" });
        return;
      }
      const decision = await requirePermission(pool, {
        userId: user.userId,
        organizationId,
        permission,
      });
      await auditAuthorizationDecision(
        pool,
        {
          userId: user.userId,
          organizationId,
          permission,
          decision: decision.granted ? "granted" : "denied",
          route: "/v1/org/permissions/check",
        },
        false,
      );
      if (!decision.granted && decision.reason === "authorization_unavailable")
        throw new Error("Authorization storage unavailable");
      json(res, 200, decision.granted ? decision : { granted: false });
      return;
    }
    const result = await configureOrganization(pool, {
      userId: user.userId,
      organizationId,
      route: req.url!,
      body: await readJson(req),
    });
    json(res, result.status, result.body);
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
