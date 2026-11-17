-- Manual migration: paste this entire file into Supabase SQL Editor after 013.
-- Includes its own transaction and ledger entry; do not run via runMigrations.
-- No existing table definitions, policies, permissions, or test data are changed.
BEGIN;
SET LOCAL search_path = public;
SELECT pg_advisory_xact_lock(1095782480, 14);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE name = '013_adaptable_organizations.sql'
  ) THEN
    RAISE EXCEPTION 'Apply migration 013 before migration 014';
  END IF;
  IF EXISTS (
    SELECT 1 FROM schema_migrations WHERE name = '014_ai_assistant.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 014 is already applied';
  END IF;
END $$;

CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lets the audit FK enforce the exact conversation owner and tenant.
  UNIQUE (id, user_id, organization_id)
);

CREATE INDEX idx_ai_conversations_owner_updated
  ON ai_conversations (organization_id, user_id, updated_at DESC, id);
CREATE INDEX idx_ai_conversations_user ON ai_conversations (user_id);

CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  -- Stable ordering even when messages share a transaction timestamp.
  sequence_number BIGINT GENERATED ALWAYS AS IDENTITY,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content JSONB NOT NULL,
  tool_calls JSONB,
  tool_call_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, sequence_number),
  CHECK (tool_calls IS NULL OR
    (role = 'assistant' AND jsonb_typeof(tool_calls) = 'array')),
  CHECK (
    (role = 'tool' AND tool_call_id IS NOT NULL AND length(trim(tool_call_id)) > 0)
    OR (role <> 'tool' AND tool_call_id IS NULL)
  )
);

CREATE TABLE ai_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  entities_accessed JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(entities_accessed) = 'array'),
  tool_calls JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(tool_calls) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, user_id, organization_id)
    REFERENCES ai_conversations(id, user_id, organization_id) ON DELETE CASCADE
);

CREATE INDEX idx_ai_audit_conversation_created
  ON ai_audit_log (conversation_id, created_at, id);
CREATE INDEX idx_ai_audit_owner_created
  ON ai_audit_log (organization_id, user_id, created_at DESC);

-- Backend-only storage, matching migration 013. Application sessions are not
-- Supabase Auth JWTs. The trusted API must enforce user + organization scoping.
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ai_conversations, ai_messages, ai_audit_log
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE ai_messages_sequence_number_seq
  FROM PUBLIC, anon, authenticated;

-- Support both the repository's name-only ledger and the manually extended
-- ledger with a version column, without altering schema_migrations.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schema_migrations'
      AND column_name = 'version'
  ) THEN
    INSERT INTO schema_migrations(version, name)
      VALUES ('014', '014_ai_assistant.sql');
  ELSE
    INSERT INTO schema_migrations(name) VALUES ('014_ai_assistant.sql');
  END IF;
END $$;

-- The handler must update conversation.updated_at, serialize turns by locking
-- the conversation row, enforce message/tool budgets, and commit the audit
-- before returning success. DDL alone does not implement fail-closed auditing.
-- Per the requested schema, deleting a conversation also deletes its audit rows.
COMMIT;
