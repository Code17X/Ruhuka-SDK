# Migration 012 and same-origin deployment

Paste the complete `apps/api/migrations/012_explicit_enrollments_permissions.sql`
into the Supabase SQL Editor. It includes a transaction and migration ledger entry;
use this manual path, not the current Node migration runner, which manages its own
transactions and ledger entries. The script has not been applied to Supabase here.

The script supports `roles.name` and the repository's older `roles.description`,
and either UUID or TEXT `students.student_id`. Enrollment references include the
organization on both foreign keys. One enrollment per student/class/term is allowed;
students can join multiple classes in a term. Statuses are pending, active,
completed, and withdrawn. RLS leaves direct browser access disabled; the trusted
backend connection must have the appropriate database privileges.

Admin receives all current catalog permissions. Teacher receives student, class,
assignment, and attendance reads scoped to assigned classes. Parent receives
attendance.read with own_student scope. Every catalogued role also receives
user.read with own_user scope. No existing staff/client memberships are
converted. Grants are additive across roles: a teacher who also holds admin retains
admin access. Existing staff/client grants are preserved.

Parent and teacher roles can call `/v1/users/me` with an active membership and
their assigned role. Authentication alone does not bypass the existing membership
requirement. Future roles must also receive the baseline grant when created.
Future attendance handlers must enforce own_student against trusted parent/student
links, and assigned_class against trusted class assignments; a permission grant
alone does not filter database rows. Enrollment is not a parent/student identity link.

Set PUBLIC_ORIGIN to the external HTTPS origin serving both Portal and API.
CORS_ORIGIN remains a fallback; local development defaults to http://localhost:3000.
Proxy `/v1/*` to the API and use relative API URLs in the Portal. Preserve Origin;
the API compares it to configuration, never Host or forwarded headers. GET requests
without Origin work; login/logout still require a matching Origin and JSON.
Trusted cross-origin local development supports credentialed CORS and preflights.
Cookies use Path=/, HttpOnly, SameSite=Lax and no Domain. Secure is set in production
or for an HTTPS public origin, even if the proxy connects to Node over HTTP.

Keep DATABASE_URL on the supplied Supabase transaction pooler at
aws-0-eu-north-1.pooler.supabase.com:6543 on this Windows machine. No credentials or
live environment values were changed. Password hashing remains argon2.

The checked-in auth implementation uses user_sessions (including created_at and
revoked_at). Migration 012 renames sessions if only that table exists, preserves its
rows, and adds the missing columns. Historical creation times are unknown, so added
created_at values use the migration time; expiry times and token hashes are retained.
If both session tables exist, the migration raises an error and rolls back. Inspect
both tables before deciding how to merge them; do not drop either speculatively.

Execution order in Supabase SQL Editor:

1. Run `docs/sql/012_preflight.sql` to inspect the session tables and permission
   catalog. Expect one session table, UUID role_id/permission_id columns and their
   foreign keys in role_permissions. If a simplified text-based catalog remains,
   retain its grants and determine a conversion from these results before proceeding.
2. Run the entire corrected Migration 012, including BEGIN and COMMIT. Its session
   rename and ALTER TABLE statements are included; no separate rename is needed.
   If an earlier 012 was applied, run this corrected script explicitly in the editor:
   the existing ledger entry does not skip the corrective statements.
3. Run `docs/sql/012_verify.sql`. The missing-profile-grants query should return no
   rows; confirm parent has attendance.read/own_student and user.read/own_user.
   Test login, `/v1/users/me`, and logout from the Portal.

No DROP TABLE command is needed for the reported FK-based schema. The active
role_permissions table is required by authorization.ts. Unknown debug/backup tables
are not removed automatically. This script does not resolve arbitrary schema drift.

Audit callers must pass a required third boolean argument. Reads pass false.
Mutations, including PATCH, pass true and await the audit before any business writes;
failures propagate to the API's generic 500 handler. The only current production
caller is GET /v1/users/me. No enrollment or assignment mutation routes exist yet.
