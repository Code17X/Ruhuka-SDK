import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Pool, type Pool as PoolType } from "pg";
import { runMigrations } from "./db/migrate.js";
import {
  authenticateSession,
  createSession,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isValidSessionToken,
  login,
  revokeSession,
  verifyPassword,
} from "./auth.js";

function fakePool(rows: unknown[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows };
    },
  } as unknown as PoolType;
  return { pool, calls };
}

describe("authentication primitives", () => {
  test("session tokens are 256-bit URL-safe random values and hashes are one-way digests", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    assert.equal(isValidSessionToken(first), true);
    assert.notEqual(first, second);
    assert.equal(hashSessionToken(first).length, 64);
    assert.notEqual(hashSessionToken(first), first);
    assert.equal(isValidSessionToken("short"), false);
  });

  test("Argon2id hashes verify only the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(
      await verifyPassword(hash, "correct horse battery staple"),
      true,
    );
    assert.equal(await verifyPassword(hash, "wrong password"), false);
  });

  test("expired sessions, revoked sessions, and disabled accounts fail at the database boundary", async () => {
    const { pool, calls } = fakePool([]);
    const token = createSessionToken();
    assert.equal(await authenticateSession(pool, token, new Date()), null);
    assert.match(calls[0]!.sql, /expires_at > \$2/);
    assert.match(calls[0]!.sql, /revoked_at IS NULL/);
    assert.match(calls[0]!.sql, /account_status = 'active'/);
    assert.equal(await authenticateSession(pool, "invalid", new Date()), null);
    assert.equal(calls.length, 1);
  });

  test("logout revokes by token hash and malformed tokens cause no database call", async () => {
    const { pool, calls } = fakePool();
    const token = createSessionToken();
    await revokeSession(pool, token);
    assert.equal(calls[0]!.values?.[0], hashSessionToken(token));
    assert.match(calls[0]!.sql, /revoked_at IS NULL/);
    await revokeSession(pool, "not-a-session-token");
    assert.equal(calls.length, 1);
  });

  test("login uses the same generic failure for unknown email and invalid password", async () => {
    const absent = fakePool([]);
    assert.equal(
      await login(absent.pool, "missing@example.invalid", "bad"),
      null,
    );
    const hash = await hashPassword("right password");
    const present = fakePool([
      { id: "user-1", password_hash: hash, account_status: "active" },
    ]);
    assert.equal(
      await login(present.pool, "known@example.invalid", "wrong password"),
      null,
    );
    assert.equal(present.calls.length, 1);
  });

  test("login also rejects disabled and passwordless accounts", async () => {
    const disabled = fakePool([
      {
        id: "disabled-user",
        password_hash: await hashPassword("right password"),
        account_status: "disabled",
      },
    ]);
    const passwordless = fakePool([
      { id: "passwordless-user", password_hash: null, account_status: "active" },
    ]);
    assert.equal(
      await login(disabled.pool, "disabled@example.invalid", "right password"),
      null,
    );
    assert.equal(
      await login(passwordless.pool, "passwordless@example.invalid", "bad"),
      null,
    );
  });
});

const databaseUrl = process.env.DATABASE_URL;
describe("PostgreSQL authentication sessions", { skip: !databaseUrl }, () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let userId: string;

  before(async () => {
    await runMigrations(pool);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2) RETURNING id`,
      ["auth-session-test@example.invalid", await hashPassword("good secret")],
    );
    userId = result.rows[0]!.id as string;
  });

  after(async () => {
    if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await pool.end();
  });

  test("expired and revoked sessions are rejected and tokens are never stored", async () => {
    const expiredToken = createSessionToken();
    const expired = await pool.query(
      `INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, now() - interval '2 hours', now() - interval '1 hour')
       RETURNING id`,
      [userId, hashSessionToken(expiredToken)],
    );
    const token = createSessionToken();
    const session = await pool.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour') RETURNING id`,
      [userId, hashSessionToken(token)],
    );
    await revokeSession(pool, token);
    const revokedCheck = await authenticateSession(pool, token);
    const expiredCheck = await authenticateSession(pool, expiredToken);
    const expiredTokenHash = await pool.query(
      "SELECT token_hash FROM user_sessions WHERE id = $1",
      [expired.rows[0]!.id],
    );
    assert.equal(revokedCheck, null);
    assert.equal(expiredCheck, null);
    assert.notEqual(expiredTokenHash.rows[0]!.token_hash, token);
    assert.ok(session.rows[0]!.id);
  });

  test("disabled accounts and bad credentials cannot authenticate", async () => {
    const { token } = await createSession(pool, userId);
    assert.deepEqual(await authenticateSession(pool, token), { userId });
    await pool.query(
      "UPDATE users SET account_status = 'disabled' WHERE id = $1",
      [userId],
    );
    assert.equal(await authenticateSession(pool, token), null);
    assert.equal(
      await login(pool, "auth-session-test@example.invalid", "good secret"),
      null,
    );
    assert.equal(
      await login(pool, "missing@example.invalid", "bad secret"),
      null,
    );
  });
});
