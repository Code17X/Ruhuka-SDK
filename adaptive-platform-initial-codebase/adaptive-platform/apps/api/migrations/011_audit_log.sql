-- Migration: 011_audit_log
-- Purpose: Persistent audit trail for authorization decisions (grants and denials)
CREATE TABLE audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    permission text NOT NULL,
    resource text,
    scope text,
    decision text NOT NULL CHECK (decision IN ('granted', 'denied')),
    reason text,
    route text
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_organization_id ON audit_log(organization_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

INSERT INTO permissions (key, description) VALUES
('audit_log.read', 'Read authorization audit logs'),
('audit_log.write', 'Write to authorization audit logs');

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'organization'
FROM roles r
CROSS JOIN permissions p
WHERE r.key = 'admin'
AND p.key IN ('audit_log.read', 'audit_log.write');

INSERT INTO schema_migrations (version, name) VALUES ('011', 'audit_log');