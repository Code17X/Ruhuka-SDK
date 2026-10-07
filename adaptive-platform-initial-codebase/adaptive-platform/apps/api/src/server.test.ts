import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { Pool } from "pg";
import { createApiServer, isTrustedOrigin } from "./server.js";
import { isJsonContentType } from "./request-content-type.js";
import type { AppConfig } from "@adaptive/config";

const config: AppConfig = {
  nodeEnv: "test",
  apiPort: 4000,
  databaseUrl: "",
  corsOrigin: "http://localhost:3000",
  aiProvider: "mock",
};

function fakePool(
  query: (sql: string, values?: unknown[]) => unknown = () => ({ rows: [] }),
) {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      return query(sql, values);
    },
  } as unknown as Pool;
  return { pool, queries };
}

async function startServer(pool: Pool, appConfig: AppConfig = config) {
  const server = createApiServer(pool, appConfig);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function postLogin(
  baseUrl: string,
  origin = config.corsOrigin,
  body: unknown = {
    email: "user@example.invalid",
    password: "not-a-real-password",
  },
) {
  return fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("authentication API request handling", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  before(async () => {
    server = await startServer(fakePool().pool);
  });

  after(async () => {
    await server.close();
  });

  test("accepts the configured origin and rejects an untrusted origin", async () => {
    assert.equal(isTrustedOrigin(config.corsOrigin, config.corsOrigin), true);
    assert.equal(
      isTrustedOrigin("https://evil.invalid", config.corsOrigin),
      false,
    );
    assert.equal(
      isTrustedOrigin("http://localhost:3000/path", config.corsOrigin),
      false,
    );
    const response = await postLogin(server.baseUrl, "https://evil.invalid");
    assert.equal(response.status, 403);
  });

  test("logout requires a trusted origin and revokes the session cookie", async () => {
    const token = "A".repeat(43);
    const { pool, queries } = fakePool();
    const app = await startServer(pool);
    try {
      const rejected = await fetch(`${app.baseUrl}/v1/auth/logout`, {
        method: "POST",
        headers: {
          Origin: "https://evil.invalid",
          "Content-Type": "application/json",
          Cookie: `ruhuka_session=${token}`,
        },
        body: "{}",
      });
      assert.equal(rejected.status, 403);
      assert.deepEqual(queries, []);

      const response = await fetch(`${app.baseUrl}/v1/auth/logout`, {
        method: "POST",
        headers: {
          Origin: config.corsOrigin,
          "Content-Type": "application/json",
          Cookie: `ruhuka_session=${token}`,
        },
        body: "{}",
      });
      assert.equal(response.status, 200);
      assert.match(queries[0]!, /UPDATE user_sessions SET revoked_at/);
      const clearedCookie = response.headers.get("set-cookie");
      assert.match(clearedCookie ?? "", /ruhuka_session=;/);
      assert.match(clearedCookie ?? "", /HttpOnly/);
      assert.match(clearedCookie ?? "", /SameSite=Strict/);
      assert.match(clearedCookie ?? "", /Path=\//);
      assert.match(clearedCookie ?? "", /Max-Age=0/);
    } finally {
      await app.close();
    }
  });

  test("accepts valid JSON media type parameters and rejects malformed types", () => {
    assert.equal(isJsonContentType("application/json"), true);
    assert.equal(isJsonContentType("Application/JSON; charset=utf-8"), true);
    assert.equal(
      isJsonContentType('application/json; charset="utf-8;v=1"'),
      true,
    );
    assert.equal(isJsonContentType("application/jsonfoo"), false);
    assert.equal(isJsonContentType("application/json; charset="), false);
    assert.equal(isJsonContentType("text/application/json"), false);
  });

  test("rejects malformed credentials before querying PostgreSQL", async () => {
    const { pool, queries } = fakePool();
    const app = await startServer(pool);
    try {
      const response = await postLogin(app.baseUrl, config.corsOrigin, {
        email: "not an email",
        password: "p",
      });
      assert.equal(response.status, 400);
      assert.deepEqual(queries, []);
    } finally {
      await app.close();
    }
  });

  test("limits a client to ten login attempts and keeps the generic failure response", async () => {
    const { pool, queries } = fakePool();
    const app = await startServer(pool);
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await postLogin(app.baseUrl);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          error: "invalid_credentials",
        });
      }
      const limited = await postLogin(app.baseUrl);
      assert.equal(limited.status, 429);
      assert.equal(queries.length, 10);
    } finally {
      await app.close();
    }
  });

  test("returns a safe server error for database failures without logging credentials", async () => {
    const { pool } = fakePool(() => {
      throw new Error("sensitive database detail");
    });
    const app = await startServer(pool);
    const originalError = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) =>
      logs.push(args.map(String).join(" "));
    try {
      const response = await postLogin(app.baseUrl);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "internal_error" });
      assert.ok(logs.some((line) => line.includes("request_failed")));
      assert.equal(
        logs.some((line) => line.includes("sensitive database detail")),
        false,
      );
      assert.equal(
        logs.some((line) => line.includes("not-a-real-password")),
        false,
      );
    } finally {
      console.error = originalError;
      await app.close();
    }
  });

  test("keeps health and demo AI routes responding", async () => {
    const health = await fetch(`${server.baseUrl}/health`);
    assert.equal(health.status, 200);
    const ai = await fetch(`${server.baseUrl}/v1/ai/sessions/demo/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    assert.equal(ai.status, 200);
  });

  test("does not expose the unauthenticated demo AI route in production", async () => {
    const productionConfig: AppConfig = {
      ...config,
      nodeEnv: "production",
      databaseUrl: "postgresql://db.invalid/platform",
      corsOrigin: "https://portal.example.invalid",
    };
    const app = await startServer(fakePool().pool, productionConfig);
    try {
      const response = await fetch(
        `${app.baseUrl}/v1/ai/sessions/demo/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "hello" }),
        },
      );
      assert.equal(response.status, 404);
    } finally {
      await app.close();
    }
  });
});
