-- Read-only: inspect metadata, without exposing credentials or session tokens.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name IN ('sessions', 'user_sessions', 'roles', 'permissions',
                     'role_permissions', 'schema_migrations')
       OR table_name LIKE 'role_permissions%')
ORDER BY table_name, ordinal_position;

SELECT c.conrelid::regclass AS table_name, c.conname,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND (t.relname IN ('sessions', 'user_sessions', 'roles', 'permissions')
       OR t.relname LIKE 'role_permissions%')
ORDER BY table_name, c.conname;
