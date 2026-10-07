import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const migrationUrl = new URL(
  "../../migrations/003_case_insensitive_user_email.sql",
  import.meta.url,
);

describe("case-insensitive email migration source", () => {
  test("keeps duplicate detection and exactly one intended unique index", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const uniqueIndexStatements =
      sql.match(/\bCREATE\s+UNIQUE\s+INDEX\b/gi) ?? [];

    assert.equal(uniqueIndexStatements.length, 1);
    assert.match(
      sql,
      /^DO \$\$\s+BEGIN\s+IF EXISTS\s*\([\s\S]*?GROUP BY lower\(email\)\s+HAVING count\(\*\) > 1\s*\)\s+THEN\s+RAISE EXCEPTION\s+'[^']+';\s+END IF;\s+END;\s+\$\$;\s+CREATE UNIQUE INDEX users_email_lower_unique_idx ON users \(lower\(email\)\);\s*$/,
    );
  });
});
