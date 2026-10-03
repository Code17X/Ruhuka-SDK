import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const migrationsDirectory = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Hold a database-scoped lock for the check/apply sequence. Using this same
    // connection for migrations also works with pools configured for one client.
    await client.query("SELECT pg_advisory_lock(1095782480, 1)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    for (const name of migrationNames) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount) continue;

      const sql = await readFile(
        new URL(`../../migrations/${name}`, import.meta.url),
        "utf8",
      );
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          name,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(1095782480, 1)");
    } finally {
      client.release();
    }
  }
}
