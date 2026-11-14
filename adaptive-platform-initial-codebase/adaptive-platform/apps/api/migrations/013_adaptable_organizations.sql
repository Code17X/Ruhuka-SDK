-- Run in Supabase SQL Editor after 012, before starting the updated API.
-- One atomic cutover. Legacy education/catalog tables remain as snapshots.
BEGIN;
SET LOCAL search_path = public;
SELECT pg_advisory_xact_lock(1095782480, 13);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE name = '013_adaptable_organizations.sql') THEN
    RAISE EXCEPTION 'Migration 013 is already applied; do not import legacy snapshots again';
  END IF;
END $$;

CREATE TABLE entity_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_key TEXT NOT NULL CHECK (type_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  schema_definition JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(schema_definition) = 'object'),
  UNIQUE (organization_id, type_key)
);
CREATE TABLE relationship_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_key TEXT NOT NULL CHECK (type_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  from_entity_type TEXT,
  to_entity_type TEXT,
  UNIQUE (organization_id, type_key),
  FOREIGN KEY (organization_id, from_entity_type) REFERENCES entity_types(organization_id, type_key),
  FOREIGN KEY (organization_id, to_entity_type) REFERENCES entity_types(organization_id, type_key)
);
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_source TEXT,
  legacy_id TEXT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, legacy_source, legacy_id),
  FOREIGN KEY (organization_id, entity_type) REFERENCES entity_types(organization_id, type_key)
);
CREATE INDEX idx_entities_org_type ON entities(organization_id, entity_type);
CREATE INDEX idx_entities_data ON entities USING GIN(data);

CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  from_entity_id UUID NOT NULL,
  to_entity_id UUID NOT NULL,
  context JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(context) = 'object'),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_source TEXT,
  legacy_id TEXT,
  UNIQUE (organization_id, legacy_source, legacy_id),
  FOREIGN KEY (organization_id, relationship_type) REFERENCES relationship_types(organization_id, type_key),
  FOREIGN KEY (organization_id, from_entity_id) REFERENCES entities(organization_id, id),
  FOREIGN KEY (organization_id, to_entity_id) REFERENCES entities(organization_id, id)
);
CREATE INDEX idx_relationships_org_type ON relationships(organization_id, relationship_type);
CREATE INDEX idx_relationships_from ON relationships(organization_id, from_entity_id, relationship_type);
CREATE INDEX idx_relationships_to ON relationships(organization_id, to_entity_id, relationship_type);

-- Trusted mapping from an authenticated membership to its graph anchor.
-- A JSON data field supplied by a caller never establishes identity.
CREATE TABLE membership_entities (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  entity_id UUID NOT NULL,
  PRIMARY KEY (organization_id, membership_id),
  UNIQUE (organization_id, entity_id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, entity_id) REFERENCES entities(organization_id, id)
);
CREATE TABLE organization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  UNIQUE (organization_id, role_key),
  UNIQUE (organization_id, id)
);
CREATE TABLE organization_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL CHECK (permission_key ~ '^[a-z][a-z0-9_.]{0,127}$'),
  description TEXT,
  UNIQUE (organization_id, permission_key),
  UNIQUE (organization_id, id)
);
CREATE TABLE organization_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id UUID NOT NULL,
  permission_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (
    scope IN ('own_user', 'organization', 'assigned_entity', 'linked_entity') OR
    scope ~ '^path:(out|in)\.[a-z][a-z0-9_]{0,63}(/(out|in)\.[a-z][a-z0-9_]{0,63}){0,3}$'
  ),
  -- Preserve multiple scopes on the same role/permission.
  UNIQUE (organization_id, role_id, permission_id, scope),
  FOREIGN KEY (organization_id, role_id) REFERENCES organization_roles(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, permission_id) REFERENCES organization_permissions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_org_grants_permission ON organization_role_permissions(organization_id, permission_id);

-- Custom role bindings avoid changing membership_roles and its legacy CHECK.
CREATE TABLE organization_membership_roles (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  role_id UUID NOT NULL,
  PRIMARY KEY (organization_id, membership_id, role_id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, role_id) REFERENCES organization_roles(organization_id, id) ON DELETE CASCADE
);

-- Trusted provisioning helpers for organizations/memberships created after 013.
-- Invoker privileges only; browser roles cannot call these via Supabase RPC.
CREATE FUNCTION bootstrap_organization_configuration(tenant UUID) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM id FROM organizations WHERE id = tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found'; END IF;
  INSERT INTO entity_types(organization_id, type_key, display_name)
    VALUES (tenant, 'membership', 'Membership') ON CONFLICT DO NOTHING;
  INSERT INTO relationship_types(organization_id, type_key, display_name)
    VALUES (tenant, 'assigned_to', 'Assigned to'), (tenant, 'linked_to', 'Linked to')
    ON CONFLICT DO NOTHING;
  INSERT INTO organization_roles(organization_id, role_key, display_name)
    VALUES (tenant, 'admin', 'Administrator') ON CONFLICT DO NOTHING;
  INSERT INTO organization_permissions(organization_id, permission_key, description)
    VALUES (tenant, 'user.read', 'Read own profile'), (tenant, 'org.configure', 'Configure organization')
    ON CONFLICT DO NOTHING;
  INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope)
    SELECT tenant, r.id, p.id, CASE WHEN p.permission_key = 'user.read' THEN 'own_user' ELSE 'organization' END
    FROM organization_roles r JOIN organization_permissions p ON p.organization_id = r.organization_id
    WHERE r.organization_id = tenant AND (p.permission_key = 'user.read' OR
      (r.role_key = 'admin' AND p.permission_key = 'org.configure'))
    ON CONFLICT DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION bootstrap_organization_configuration(UUID) FROM PUBLIC;

CREATE FUNCTION ensure_membership_entity(tenant UUID, member UUID) RETURNS UUID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE existing UUID; member_data JSONB;
BEGIN
  SELECT to_jsonb(m) INTO member_data FROM memberships m
    WHERE m.organization_id = tenant AND m.id = member FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found in organization'; END IF;
  SELECT entity_id INTO existing FROM membership_entities WHERE organization_id = tenant AND membership_id = member;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  INSERT INTO entity_types(organization_id, type_key, display_name)
    VALUES (tenant, 'membership', 'Membership') ON CONFLICT DO NOTHING;
  INSERT INTO entities(organization_id, entity_type, data)
    VALUES (tenant, 'membership', member_data - 'organization_id') RETURNING id INTO existing;
  INSERT INTO membership_entities(organization_id, membership_id, entity_id) VALUES (tenant, member, existing);
  RETURN existing;
END $$;
REVOKE EXECUTE ON FUNCTION ensure_membership_entity(UUID, UUID) FROM PUBLIC;

-- Database enforcement of optional relationship endpoint type restrictions.
CREATE FUNCTION validate_relationship_endpoints() RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE source_type TEXT; target_type TEXT; definition RECORD;
BEGIN
  SELECT * INTO STRICT definition FROM relationship_types
  WHERE organization_id = NEW.organization_id AND type_key = NEW.relationship_type;
  SELECT entity_type INTO STRICT source_type FROM entities
  WHERE organization_id = NEW.organization_id AND id = NEW.from_entity_id;
  SELECT entity_type INTO STRICT target_type FROM entities
  WHERE organization_id = NEW.organization_id AND id = NEW.to_entity_id;
  IF (definition.from_entity_type IS NOT NULL AND definition.from_entity_type <> source_type)
     OR (definition.to_entity_type IS NOT NULL AND definition.to_entity_type <> target_type) THEN
    RAISE EXCEPTION 'Relationship endpoint type mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER relationships_validate_types BEFORE INSERT OR UPDATE ON relationships
FOR EACH ROW EXECUTE FUNCTION validate_relationship_endpoints();

-- Entity types cannot be changed underneath validated relationships/identity links.
CREATE FUNCTION preserve_entity_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id OR NEW.entity_type <> OLD.entity_type THEN
    RAISE EXCEPTION 'Entity organization and type are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER entities_preserve_identity BEFORE UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION preserve_entity_identity();

-- Every existing organization receives a separate copy of its legacy catalog.
INSERT INTO organization_roles(organization_id, role_key, display_name)
SELECT o.id, r.key, COALESCE(to_jsonb(r)->>'name', to_jsonb(r)->>'description', r.key)
FROM organizations o CROSS JOIN roles r;
INSERT INTO organization_roles(organization_id, role_key, display_name)
SELECT organization_id, role, role FROM membership_roles
ON CONFLICT (organization_id, role_key) DO NOTHING;
INSERT INTO organization_roles(organization_id, role_key, display_name)
SELECT id, 'admin', 'Administrator' FROM organizations
ON CONFLICT (organization_id, role_key) DO NOTHING;
INSERT INTO organization_permissions(organization_id, permission_key, description)
SELECT o.id, p.key, p.description FROM organizations o CROSS JOIN permissions p;
INSERT INTO organization_permissions(organization_id, permission_key, description)
SELECT o.id, p.key, p.description FROM organizations o CROSS JOIN (VALUES
  ('user.read', 'Read own profile'),
  ('org.configure', 'Configure this organization data model and access policy')
) p(key, description)
ON CONFLICT (organization_id, permission_key) DO NOTHING;

-- Translate education scopes to explicit, bounded generic graph paths.
INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope)
SELECT nr.organization_id, nr.id, np.id,
 CASE
  WHEN rp.scope IN ('own_user', 'organization') THEN rp.scope
  WHEN rp.scope IN ('linked_student', 'own_student') THEN
    CASE WHEN p.key LIKE 'attendance.%' THEN 'path:out.linked_to/in.attendance_for'
         ELSE 'path:out.linked_to' END
  WHEN rp.scope = 'assigned_class' THEN
    CASE WHEN p.key LIKE 'student.%' THEN 'path:out.assigned_to/in.enrolled_in'
         WHEN p.key LIKE 'attendance.%' THEN 'path:out.assigned_to/in.enrolled_in/in.attendance_for'
         ELSE 'assigned_entity' END
  WHEN rp.scope = 'department' THEN 'path:out.member_of'
  ELSE rp.scope -- Unsupported scopes fail the CHECK instead of widening access.
 END
FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
JOIN organization_roles nr ON nr.role_key = r.key
JOIN organization_permissions np ON np.organization_id = nr.organization_id AND np.permission_key = p.key
ON CONFLICT DO NOTHING;
INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope)
SELECT r.organization_id, r.id, p.id, 'own_user'
FROM organization_roles r JOIN organization_permissions p
  ON p.organization_id = r.organization_id AND p.permission_key = 'user.read'
ON CONFLICT DO NOTHING;
INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope)
SELECT r.organization_id, r.id, p.id, 'organization'
FROM organization_roles r JOIN organization_permissions p
  ON p.organization_id = r.organization_id AND p.permission_key = 'org.configure'
WHERE r.role_key = 'admin' ON CONFLICT DO NOTHING;

-- Import entities without assuming whether legacy student IDs are UUID or TEXT.
-- The original row is retained as JSON, including its source identifier.
CREATE FUNCTION pg_temp.import_entities(source_table TEXT, type_name TEXT, key_name TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE item JSONB; tenant UUID;
BEGIN
  IF to_regclass('public.' || source_table) IS NULL THEN RETURN; END IF;
  FOR item IN EXECUTE format('SELECT to_jsonb(s) FROM public.%I s', source_table) LOOP
    tenant := (item->>'organization_id')::UUID;
    INSERT INTO entity_types(organization_id, type_key, display_name)
      VALUES (tenant, type_name, initcap(replace(type_name, '_', ' '))) ON CONFLICT DO NOTHING;
    INSERT INTO entities(organization_id, entity_type, data, legacy_source, legacy_id, created_at, updated_at)
    VALUES (tenant, type_name, item - 'organization_id', source_table, item->>key_name,
      COALESCE((item->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((item->>'updated_at')::TIMESTAMPTZ, now()));
  END LOOP;
END $$;
SELECT pg_temp.import_entities('memberships', 'membership', 'id');
SELECT pg_temp.import_entities('students', 'student', 'student_id');
SELECT pg_temp.import_entities('classes', 'class', 'id');
SELECT pg_temp.import_entities('departments', 'department', 'id');
SELECT pg_temp.import_entities('attendance', 'attendance', 'id');
SELECT pg_temp.import_entities('staff_profiles', 'staff_profile', 'id');
SELECT pg_temp.import_entities('teachers', 'teacher', 'id');
SELECT pg_temp.import_entities('parents', 'parent', 'id');
INSERT INTO membership_entities(organization_id, membership_id, entity_id)
SELECT m.organization_id, m.id, e.id FROM memberships m JOIN entities e
  ON e.organization_id = m.organization_id AND e.legacy_source = 'memberships' AND e.legacy_id = m.id::TEXT;

-- Built-in relationship names are templates; arbitrary names can be configured.
INSERT INTO relationship_types(organization_id, type_key, display_name)
SELECT o.id, t.key, t.name FROM organizations o CROSS JOIN (VALUES
  ('linked_to', 'Linked to'), ('assigned_to', 'Assigned to'),
  ('enrolled_in', 'Enrolled in'), ('member_of', 'Member of'),
  ('attendance_for', 'Attendance for'), ('profile_of', 'Profile of')
) t(key, name);

CREATE FUNCTION pg_temp.import_relationships(source_table TEXT, relation_name TEXT,
  from_source TEXT, from_key TEXT, to_source TEXT, to_key TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE item JSONB; tenant UUID; source_id UUID; target_id UUID;
BEGIN
  IF to_regclass('public.' || source_table) IS NULL THEN RETURN; END IF;
  FOR item IN EXECUTE format('SELECT to_jsonb(s) FROM public.%I s', source_table) LOOP
    tenant := (item->>'organization_id')::UUID;
    SELECT id INTO source_id FROM entities WHERE organization_id = tenant
      AND legacy_source = from_source AND legacy_id = item->>from_key;
    SELECT id INTO target_id FROM entities WHERE organization_id = tenant
      AND legacy_source = to_source AND legacy_id = item->>to_key;
    IF source_id IS NULL OR target_id IS NULL THEN
      RAISE EXCEPTION 'Unresolved or cross-tenant relationship in %, row %', source_table, item->>'id';
    END IF;
    INSERT INTO relationships(organization_id, relationship_type, from_entity_id, to_entity_id,
      context, legacy_source, legacy_id, created_at, active)
    VALUES (tenant, relation_name, source_id, target_id, item - 'organization_id', source_table,
      item->>'id', COALESCE((item->>'created_at')::TIMESTAMPTZ, now()),
      CASE WHEN source_table = 'enrollments' THEN item->>'status' = 'active' ELSE true END);
  END LOOP;
END $$;
SELECT pg_temp.import_relationships('client_student_links','linked_to','memberships','membership_id','students','student_id');
SELECT pg_temp.import_relationships('staff_class_assignments','assigned_to','memberships','membership_id','classes','class_id');
SELECT pg_temp.import_relationships('staff_department_assignments','member_of','memberships','membership_id','departments','department_id');
SELECT pg_temp.import_relationships('enrollments','enrolled_in','students','student_id','classes','class_id');
SELECT pg_temp.import_relationships('attendance','attendance_for','attendance','id','students','student_id');
SELECT pg_temp.import_relationships('staff_profiles','profile_of','staff_profiles','id','memberships','membership_id');

-- Education sample definitions for the existing test organization, without
-- changing the test user's password, status, membership, or role assignment.
INSERT INTO entity_types(organization_id, type_key, display_name, schema_definition)
SELECT o.id, t.key, t.name, t.definition::JSONB FROM organizations o CROSS JOIN (VALUES
  ('student','Student','{"type":"object","properties":{"display_name":{"type":"string"}}}'),
  ('class','Class','{"type":"object","properties":{"name":{"type":"string"}}}'),
  ('attendance','Attendance','{"type":"object","properties":{"status":{"type":"string"}}}')
) t(key, name, definition)
WHERE o.id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
ON CONFLICT (organization_id, type_key) DO NOTHING;

-- New tables are backend-only. No Supabase anon/authenticated policies are added.
DO $$ DECLARE name TEXT; BEGIN
  FOREACH name IN ARRAY ARRAY['entity_types','relationship_types','entities','relationships',
    'membership_entities','organization_roles','organization_permissions',
    'organization_role_permissions','organization_membership_roles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'schema_migrations' AND column_name = 'version') THEN
    INSERT INTO schema_migrations(version, name) VALUES ('013', '013_adaptable_organizations.sql');
  ELSE
    INSERT INTO schema_migrations(name) VALUES ('013_adaptable_organizations.sql');
  END IF;
END $$;
COMMIT;
