import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import argon2 from "argon2";
import { isValidLoginInput } from "./login-validation.js";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const DUMMY_PASSWORD = "ruhuka-fixed-dummy-password";
const DUMMY_PASSWORD_HASH = argon2.hash(DUMMY_PASSWORD, {
  type: argon2.argon2id,
});

export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export interface AuthenticatedUser {
  userId: string;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  pool: Pool,
  userId: string,
  now = new Date(),
): Promise<CreatedSession> {
  const token = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashSessionToken(token), now, expiresAt],
  );
  return { token, expiresAt };
}

export async function authenticateSession(
  pool: Pool,
  token: string | undefined,
  now = new Date(),
): Promise<AuthenticatedUser | null> {
  if (!token || !isValidSessionToken(token)) return null;
  const result = await pool.query<{ user_id: string }>(
    `SELECT s.user_id
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > $2
        AND s.revoked_at IS NULL
        AND u.account_status = 'active'`,
    [hashSessionToken(token), now],
  );
  return result.rows[0] ? { userId: result.rows[0].user_id } : null;
}

export async function revokeSession(
  pool: Pool,
  token: string | undefined,
  now = new Date(),
): Promise<void> {
  if (!token || !isValidSessionToken(token)) return;
  await pool.query(
    `UPDATE user_sessions SET revoked_at = $2
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSessionToken(token), now],
  );
}

export async function login(
  pool: Pool,
  email: string,
  password: string,
): Promise<CreatedSession | null> {
  if (!isValidLoginInput(email, password)) return null;
  const result = await pool.query<{
    id: string;
    password_hash: string | null;
    account_status: string;
  }>(
    `SELECT id, password_hash, account_status FROM users WHERE lower(email) = lower($1) LIMIT 2`,
    [email.trim()],
  );
  const user = result.rows[0];
  const eligible =
    result.rows.length === 1 &&
    !!user &&
    user.account_status === "active" &&
    !!user.password_hash;
  const passwordMatches = await verifyPassword(
    eligible ? user.password_hash! : await DUMMY_PASSWORD_HASH,
    password,
  );
  if (!eligible || !user || !passwordMatches) return null;
  return createSession(pool, user.id);
}
