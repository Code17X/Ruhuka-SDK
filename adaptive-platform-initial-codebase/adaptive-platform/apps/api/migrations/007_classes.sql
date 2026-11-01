-- Migration: 007_classes
-- Purpose: Define the class entity for the organization.
-- Rules: 
-- 1. Classes belong to a specific organization.
-- 2. Class names must be unique within an organization to prevent duplication.

CREATE TABLE classes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_class_name_per_org UNIQUE (organization_id, name)
);

CREATE INDEX idx_classes_organization_id ON classes(organization_id);

INSERT INTO schema_migrations (version, name) VALUES ('007', 'classes');