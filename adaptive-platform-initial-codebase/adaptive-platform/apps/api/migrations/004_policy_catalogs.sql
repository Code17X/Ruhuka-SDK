CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (length(trim(key)) > 0),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (length(trim(key)) > 0),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('own_user', 'linked_student', 'assigned_class', 'department', 'organization')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id, scope)
);

CREATE INDEX role_permissions_role_id_idx ON role_permissions (role_id);
CREATE INDEX role_permissions_permission_id_idx ON role_permissions (permission_id);

INSERT INTO roles (key, description) VALUES
  ('admin', 'Organization administrator'),
  ('staff', 'Organization staff member'),
  ('client', 'Client linked to a student');

INSERT INTO permissions (key, description) VALUES
  ('organization.read', 'Read the current organization context'),
  ('organization.update', 'Update organization settings'),
  ('membership.read', 'Read organization memberships'),
  ('membership.create', 'Create organization memberships'),
  ('membership.update', 'Update organization membership status'),
  ('membership.manage', 'Manage membership roles'),
  ('user.read', 'Read own user profile'),
  ('user.update', 'Update own user profile'),
  ('student.read', 'Read organization student records'),
  ('student.create', 'Create student records'),
  ('student.update', 'Update student records'),
  ('class.read', 'Read class records'),
  ('class.create', 'Create class records'),
  ('class.update', 'Update class records'),
  ('attendance.read', 'Read attendance records'),
  ('attendance.create', 'Create attendance records'),
  ('attendance.update', 'Update attendance records'),
  ('staff_profile.read', 'Read staff profiles'),
  ('staff_profile.create', 'Create staff profiles'),
  ('staff_profile.update', 'Update staff profiles'),
  ('ai_session.read', 'Read authorized AI sessions'),
  ('ai_session.create', 'Create AI sessions');

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, grants.scope
FROM (VALUES
  ('admin', 'organization.read', 'organization'),
  ('staff', 'organization.read', 'organization'),
  ('client', 'organization.read', 'organization'),
  ('admin', 'organization.update', 'organization'),
  ('admin', 'membership.read', 'organization'),
  ('admin', 'membership.create', 'organization'),
  ('admin', 'membership.update', 'organization'),
  ('admin', 'membership.manage', 'organization'),
  ('admin', 'user.read', 'own_user'), ('staff', 'user.read', 'own_user'), ('client', 'user.read', 'own_user'),
  ('admin', 'user.update', 'own_user'), ('staff', 'user.update', 'own_user'), ('client', 'user.update', 'own_user'),
  ('admin', 'student.read', 'organization'), ('staff', 'student.read', 'assigned_class'), ('client', 'student.read', 'linked_student'),
  ('admin', 'student.create', 'organization'), ('admin', 'student.update', 'organization'),
  ('admin', 'class.read', 'organization'), ('staff', 'class.read', 'assigned_class'),
  ('admin', 'class.create', 'organization'), ('admin', 'class.update', 'organization'),
  ('admin', 'attendance.read', 'organization'), ('staff', 'attendance.read', 'assigned_class'), ('client', 'attendance.read', 'linked_student'),
  ('admin', 'attendance.create', 'organization'), ('staff', 'attendance.create', 'assigned_class'),
  ('admin', 'attendance.update', 'organization'), ('staff', 'attendance.update', 'assigned_class'),
  ('admin', 'staff_profile.read', 'organization'), ('staff', 'staff_profile.read', 'own_user'),
  ('admin', 'staff_profile.create', 'organization'),
  ('admin', 'staff_profile.update', 'organization'), ('staff', 'staff_profile.update', 'own_user'),
  ('admin', 'ai_session.read', 'organization'), ('staff', 'ai_session.read', 'own_user'), ('client', 'ai_session.read', 'own_user'),
  ('admin', 'ai_session.create', 'organization'), ('staff', 'ai_session.create', 'own_user'), ('client', 'ai_session.create', 'own_user')
) AS grants(role_key, permission_key, scope)
JOIN roles r ON r.key = grants.role_key
JOIN permissions p ON p.key = grants.permission_key;
