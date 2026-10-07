import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ConfigValidationError,
  loadConfig,
} from "../../../packages/config/src/index.js";

describe("application configuration", () => {
  test("keeps local development defaults", () => {
    assert.deepEqual(loadConfig({}), {
      nodeEnv: "development",
      apiPort: 4000,
      databaseUrl: "",
      corsOrigin: "http://localhost:3000",
      aiProvider: "mock",
    });
  });

  test("accepts each supported environment and inclusive port boundaries", () => {
    for (const nodeEnv of ["development", "test", "production"] as const) {
      const config = loadConfig({
        NODE_ENV: nodeEnv,
        API_PORT: nodeEnv === "test" ? "1" : "65535",
        DATABASE_URL:
          nodeEnv === "production" ? "postgresql://db.invalid/platform" : "",
        CORS_ORIGIN:
          nodeEnv === "production"
            ? "https://portal.example.invalid"
            : undefined,
      });
      assert.equal(config.nodeEnv, nodeEnv);
      assert.equal(config.apiPort, nodeEnv === "test" ? 1 : 65535);
    }
  });

  test("rejects unsupported environment names and malformed ports", () => {
    for (const env of ["staging", "", "Production"]) {
      assert.throws(() => loadConfig({ NODE_ENV: env }), ConfigValidationError);
    }
    for (const API_PORT of ["0", "65536", "4.5", "4x", " 4000", ""]) {
      assert.throws(() => loadConfig({ API_PORT }), ConfigValidationError);
    }
  });

  test("requires valid production database and secure CORS settings", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "production" }),
      /DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://db.invalid/platform",
        }),
      /CORS_ORIGIN is required/,
    );
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://db.invalid/platform",
          CORS_ORIGIN: "http://portal.example.invalid",
        }),
      ConfigValidationError,
    );
  });

  test("rejects malformed database URLs and CORS values containing paths", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: "https://db.invalid/platform" }),
      ConfigValidationError,
    );
    assert.throws(
      () =>
        loadConfig({
          DATABASE_URL: "postgresql://db.invalid/platform#fragment",
        }),
      ConfigValidationError,
    );
    for (const CORS_ORIGIN of [
      "http://localhost:3000/app",
      "http://localhost:3000/?next=/app",
      "not an origin",
    ]) {
      assert.throws(() => loadConfig({ CORS_ORIGIN }), ConfigValidationError);
    }
  });
});
