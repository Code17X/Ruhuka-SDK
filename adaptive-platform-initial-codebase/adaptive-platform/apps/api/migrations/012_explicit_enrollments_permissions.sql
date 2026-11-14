-- Paste this entire script into the Supabase SQL Editor.
-- Targets the public schema; supports both the original catalog and the manually
-- repaired catalog. No existing memberships or client/student links are changed.
BEGIN;
SET LOCAL search_path = public;

-- auth.ts creates, validates, and revokes sessions in user_sessions.
-- If both names exist, stop rather than guessing which data to discard or merge.
DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    IF to_regclass('public.user_sessions') IS NOT NULL THEN
      RAISE EXCEPTION 'Both sessions and user_sessions exist. Inspect both before merging; no changes committed.';
    END IF;
    ALTER TABLE public.sessions RENAME TO user_sessions;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
-- The simplified sessions table lacked these two columns. Preserve its rows.
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE user_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_012_idx
  ON user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expiration_idx
  ON user_sessions (expires_at) WHERE revoked_at IS NULL;

-- Never drop an uninspected debugging table or silently discard its grants.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'role_permissions'
        AND column_name IN ('role_id', 'permission_id', 'scope')) <> 3 THEN
    RAISE EXCEPTION 'role_permissions must contain role_id, permission_id, scope. Inspect the simplified table before converting it; no changes committed.';
  END IF;
END $$;

-- Reconcile roles.name (live schema) and roles.description (migration 004).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS description TEXT;
INSERT INTO roles (id, key, name, description) VALUES
  (gen_random_uuid(), 'admin', 'Administrator', 'Organization administrator'),
  (gen_random_uuid(), 'teacher', 'Teacher', 'Teacher with assigned-class read access'),
  (gen_random_uuid(), 'parent', 'Parent', 'Parent with linked-student attendance access')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- Extend existing CHECKs instead of dropping their original accepted values.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname, pg_get_expr(conbin, conrelid) AS expression
    FROM pg_constraint
    WHERE conrelid = 'public.membership_roles'::regclass AND contype = 'c'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                         WHERE attrelid = 'public.membership_roles'::regclass AND attname = 'role')]
  LOOP
    EXECUTE format('ALTER TABLE membership_roles DROP CONSTRAINT %I', c.conname);
    EXECUTE format('ALTER TABLE membership_roles ADD CONSTRAINT %I CHECK ((%s) OR role IN (''teacher'', ''parent''))', c.conname, c.expression);
  END LOOP;
  FOR c IN
    SELECT conname, pg_get_expr(conbin, conrelid) AS expression
    FROM pg_constraint
    WHERE conrelid = 'public.role_permissions'::regclass AND contype = 'c'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                         WHERE attrelid = 'public.role_permissions'::regclass AND attname = 'scope')]
  LOOP
    EXECUTE format('ALTER TABLE role_permissions DROP CONSTRAINT %I', c.conname);
    EXECUTE format('ALTER TABLE role_permissions ADD CONSTRAINT %I CHECK ((%s) OR scope = ''own_student'')', c.conname, c.expression);
  END LOOP;
END $$;

-- Composite references prevent cross-organization enrollment links.
CREATE UNIQUE INDEX IF NOT EXISTS students_enrollment_tenant_key
  ON students (organization_id, student_id);
CREATE UNIQUE INDEX IF NOT EXISTS classes_enrollment_tenant_key
  ON classes (organization_id, id);

-- Migration 001 uses TEXT student IDs; the repaired live schema may use UUID.
-- Match the actual parent column instead of assuming a different identifier.
DO $$
DECLARE student_type TEXT;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO STRICT student_type
  FROM pg_attribute WHERE attrelid = 'public.students'::regclass
    AND attname = 'student_id' AND NOT attisdropped;
  IF student_type NOT IN ('text', 'uuid') THEN
    RAISE EXCEPTION 'Unsupported students.student_id type: %', student_type;
  END IF;
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id %s NOT NULL,
      class_id UUID NOT NULL,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      term TEXT NOT NULL CHECK (length(trim(term)) > 0),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'completed', 'withdrawn')),
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (organization_id, student_id)
        REFERENCES students (organization_id, student_id) ON DELETE RESTRICT,
      FOREIGN KEY (organization_id, class_id)
        REFERENCES classes (organization_id, id) ON DELETE RESTRICT,
      UNIQUE (organization_id, student_id, class_id, term)
    )
  $ddl$, student_type);
END $$;
CREATE INDEX IF NOT EXISTS enrollments_class_term_status_idx
  ON enrollments (organization_id, class_id, term, status);
CREATE INDEX IF NOT EXISTS enrollments_student_term_idx
  ON enrollments (organization_id, student_id, term);
-- Backend-only access; browser roles receive no direct enrollment access.
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

INSERT INTO permissions (id, key, description) VALUES
  (gen_random_uuid(), 'student.read', 'Read student records'),
  (gen_random_uuid(), 'student.update', 'Update student records'),
  (gen_random_uuid(), 'class.read', 'Read classes'),
  (gen_random_uuid(), 'class.update', 'Update classes'),
  (gen_random_uuid(), 'enrollment.manage', 'Manage student enrollments'),
  (gen_random_uuid(), 'assignment.manage', 'Manage staff class assignments'),
  (gen_random_uuid(), 'assignment.read', 'Read staff class assignments'),
  (gen_random_uuid(), 'attendance.read', 'Read attendance records')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO permissions (id, key, description)
VALUES (gen_random_uuid(), 'user.read', 'Read own user profile')
ON CONFLICT (key) DO NOTHING;

-- Reconcile teacher/parent grants exactly, including removal of stale writes.
-- Existing staff/client grants and memberships are intentionally preserved.
DELETE FROM role_permissions WHERE role_id IN
  (SELECT id FROM roles WHERE key IN ('teacher', 'parent'));
INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, grant_spec.scope
FROM (VALUES
  ('teacher', 'student.read', 'assigned_class'),
  ('teacher', 'class.read', 'assigned_class'),
  ('teacher', 'assignment.read', 'assigned_class'),
  ('teacher', 'attendance.read', 'assigned_class'),
  ('parent', 'attendance.read', 'own_student')
) AS grant_spec(role_key, permission_key, scope)
JOIN roles r ON r.key = grant_spec.role_key
JOIN permissions p ON p.key = grant_spec.permission_key;

-- Admin receives every currently catalogued permission. Self-profile permissions
-- retain own_user, which /v1/users/me explicitly requires.
INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, CASE WHEN p.key IN ('user.read', 'user.update')
  THEN 'own_user' ELSE 'organization' END
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'admin' AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id
    AND rp.permission_id = p.id AND rp.scope = CASE
      WHEN p.key IN ('user.read', 'user.update') THEN 'own_user' ELSE 'organization' END
);

-- Baseline for every catalogued role, including parent and teacher.
-- Membership and own_user enforcement in requirePermission remain in effect.
INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'own_user'
FROM roles r CROSS JOIN permissions p
WHERE p.key = 'user.read' AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.scope = 'own_user'
);

-- Support the SQL Editor's versioned ledger and the original name-only ledger.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'schema_migrations'
               AND column_name = 'version') THEN
    INSERT INTO schema_migrations (version, name)
      VALUES ('012', '012_explicit_enrollments_permissions.sql') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO schema_migrations (name)
      VALUES ('012_explicit_enrollments_permissions.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;
COMMIT;
