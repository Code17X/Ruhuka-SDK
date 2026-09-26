export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  apiPort: number;
  databaseUrl: string;
  corsOrigin: string;
  aiProvider: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: (env.NODE_ENV ?? "development") as AppConfig["nodeEnv"],
    apiPort: Number(env.API_PORT ?? 4000),
    databaseUrl: env.DATABASE_URL ?? "",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000",
    aiProvider: env.AI_PROVIDER ?? "mock"
  };
}
