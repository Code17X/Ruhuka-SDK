import { createDatabasePool } from "./pool.js";
import { runMigrations } from "./migrate.js";

const pool = createDatabasePool();
try {
  await runMigrations(pool);
} finally {
  await pool.end();
}
