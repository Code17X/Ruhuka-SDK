-- Migration: 009_departments
-- Purpose: Define the department entity for the organization.
-- Rules: 
-- 1. Departments belong to a specific organization.
-- 2. Department names must be unique within an organization.

CREATE TABLE departments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_department_name_per_org UNIQUE (organization_id, name)
);

CREATE INDEX idx_departments_organization_id ON departments(organization_id);

INSERT INTO schema_migrations (version, name) VALUES ('009', 'departments');