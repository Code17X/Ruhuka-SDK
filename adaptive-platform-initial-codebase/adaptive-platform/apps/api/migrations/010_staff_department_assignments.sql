-- Migration: 010_staff_department_assignments
-- Purpose: Link staff memberships to specific departments.
-- Rules:
-- 1. Trusted backend-managed data only.
-- 2. A staff membership can be assigned to multiple departments.
-- 3. A department can have multiple staff memberships assigned to it.
-- 4. Assignments are strictly scoped to the organization.

CREATE TABLE staff_department_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_staff_department_assignment UNIQUE (organization_id, membership_id, department_id)
);

CREATE INDEX idx_staff_department_assignments_membership_id ON staff_department_assignments(membership_id);
CREATE INDEX idx_staff_department_assignments_department_id ON staff_department_assignments(department_id);

INSERT INTO schema_migrations (version, name) VALUES ('010', 'staff_department_assignments');