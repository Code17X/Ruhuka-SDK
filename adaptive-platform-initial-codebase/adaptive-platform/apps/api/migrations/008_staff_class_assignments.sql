-- Migration: 008_staff_class_assignments
-- Purpose: Link staff memberships to specific classes.
-- Rules:
-- 1. Trusted backend-managed data only (caller-supplied IDs cannot establish this link).
-- 2. A staff membership can be assigned to multiple classes.
-- 3. A class can have multiple staff memberships assigned to it.
-- 4. Assignments are strictly scoped to the organization.

CREATE TABLE staff_class_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_staff_class_assignment UNIQUE (organization_id, membership_id, class_id)
);

CREATE INDEX idx_staff_class_assignments_membership_id ON staff_class_assignments(membership_id);
CREATE INDEX idx_staff_class_assignments_class_id ON staff_class_assignments(class_id);

INSERT INTO schema_migrations (version, name) VALUES ('008', 'staff_class_assignments');