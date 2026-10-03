import { Pool } from "pg";
import { loadConfig } from "@adaptive/config";

export function createDatabasePool(
  databaseUrl = loadConfig().databaseUrl,
): Pool {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set to connect to PostgreSQL");
  }

  return new Pool({ connectionString: databaseUrl });
}
