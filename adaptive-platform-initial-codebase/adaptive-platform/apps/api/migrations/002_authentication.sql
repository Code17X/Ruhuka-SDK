ALTER TABLE users
  ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'disabled')),
  ADD COLUMN password_hash TEXT;

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expiration_idx ON user_sessions (expires_at)
  WHERE revoked_at IS NULL;
