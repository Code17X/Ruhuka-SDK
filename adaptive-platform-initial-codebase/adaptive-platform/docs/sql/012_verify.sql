-- Expected: sessions = NULL; user_sessions and enrollments exist.
SELECT to_regclass('public.sessions') AS sessions,
       to_regclass('public.user_sessions') AS user_sessions,
       to_regclass('public.enrollments') AS enrollments;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_sessions'
ORDER BY ordinal_position;

SELECT r.key AS role, p.key AS permission, rp.scope
FROM public.role_permissions rp
JOIN public.roles r ON r.id = rp.role_id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE r.key IN ('parent', 'teacher', 'admin')
ORDER BY r.key, p.key, rp.scope;

-- Expected: zero rows. All catalogued roles must have baseline profile access.
SELECT r.key AS role_missing_profile_access
FROM public.roles r
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = r.id AND p.key = 'user.read' AND rp.scope = 'own_user'
);

-- Expected: zero rows. Unknown role keys cannot resolve catalog permissions.
SELECT DISTINCT mr.role AS membership_role_missing_from_catalog
FROM public.membership_roles mr
LEFT JOIN public.roles r ON r.key = mr.role
WHERE r.id IS NULL;

SELECT name, applied_at FROM public.schema_migrations
WHERE name = '012_explicit_enrollments_permissions.sql';
