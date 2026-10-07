export type NodeEnvironment = "development" | "test" | "production";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  apiPort: number;
  databaseUrl: string;
  corsOrigin: string;
  aiProvider: string;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const nodeEnv = value ?? "development";
  if (
    nodeEnv === "development" ||
    nodeEnv === "test" ||
    nodeEnv === "production"
  ) {
    return nodeEnv;
  }
  throw new ConfigValidationError(
    "NODE_ENV must be development, test, or production",
  );
}

function parseApiPort(value: string | undefined): number {
  const rawPort = value ?? "4000";
  if (!/^\d+$/.test(rawPort)) {
    throw new ConfigValidationError(
      "API_PORT must be an integer from 1 to 65535",
    );
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigValidationError(
      "API_PORT must be an integer from 1 to 65535",
    );
  }
  return port;
}

function validateDatabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      parsed.hostname.length > 0 &&
      parsed.hash === "" &&
      value.trim() === value
    );
  } catch {
    return false;
  }
}

function validateCorsOrigin(value: string, production: boolean): boolean {
  try {
    const parsed = new URL(value);
    const allowedScheme =
      parsed.protocol === "https:" ||
      (!production && parsed.protocol === "http:");
    const isOriginOnly =
      value === parsed.origin || value === `${parsed.origin}/`;
    return (
      allowedScheme &&
      isOriginOnly &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = parseNodeEnvironment(env.NODE_ENV);
  const apiPort = parseApiPort(env.API_PORT);
  const production = nodeEnv === "production";
  const databaseUrl = env.DATABASE_URL ?? "";
  const configuredCorsOrigin = env.CORS_ORIGIN;
  const corsOrigin = configuredCorsOrigin ?? "http://localhost:3000";

  if (production && databaseUrl.length === 0) {
    throw new ConfigValidationError("DATABASE_URL is required in production");
  }
  if (databaseUrl.length > 0 && !validateDatabaseUrl(databaseUrl)) {
    throw new ConfigValidationError(
      "DATABASE_URL must be a valid PostgreSQL URL",
    );
  }
  if (production && configuredCorsOrigin === undefined) {
    throw new ConfigValidationError("CORS_ORIGIN is required in production");
  }
  if (!validateCorsOrigin(corsOrigin, production)) {
    throw new ConfigValidationError(
      "CORS_ORIGIN must be a valid origin without a path",
    );
  }

  return {
    nodeEnv,
    apiPort,
    databaseUrl,
    corsOrigin,
    aiProvider: env.AI_PROVIDER ?? "mock",
  };
}
