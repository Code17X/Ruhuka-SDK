-- Migration: 006_client_student_links
-- Purpose: Link client memberships to students.
-- Rules: 
-- 1. At most ONE student per client membership per organization.
-- 2. Student sharing is allowed (same student_id can have multiple memberships, e.g., two parents).
-- 3. Student deletion is restricted while linked to prevent orphaned authorization gaps.

CREATE TABLE client_student_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    
    -- Enforces: a specific membership in a specific org can only link to ONE student
    CONSTRAINT unique_client_student_per_org UNIQUE (organization_id, membership_id)
);

-- Indexes for efficient lookups (both forward and reverse)
CREATE INDEX idx_client_student_links_student_id ON client_student_links(student_id);
CREATE INDEX idx_client_student_links_membership_id ON client_student_links(membership_id);

-- Register the migration
INSERT INTO schema_migrations (version, name) VALUES ('006', 'client_student_links');