# Database foundation

The API uses PostgreSQL through the `pg` driver. The explicit SQL migrations in
`apps/api/migrations` are applied in lexicographic filename order and recorded
in `schema_migrations`. Run them with `pnpm --filter @adaptive/api db:migrate`
after setting `DATABASE_URL`.

## Identity and tenant-owned data

- `organizations` represents a school or other tenant. Its UUID is stable and
  is the tenant key used by organization-owned records.
- `users` is the global identity table. It stores authentication identity data
  independently of any organization relationship.
- `memberships` connects a user to an organization and carries relationship
  status and timestamps. A unique constraint on `(organization_id, user_id)`
  prevents duplicate memberships while allowing one user to join multiple
  organizations.
- `membership_roles` holds roles for a membership. The initial allowed roles
  are `visitor`, `client`, `staff`, and `admin`; a membership can have several
  different roles, but cannot have the same role twice. Roles belong here
  because they describe a user's relationship to one organization, not their
  global identity.
- `staff_profiles` stores organization-specific staff details and references
  the staff member's membership. It does not attach staff data directly to a
  global user.
- `students` is the organization-scoped student/client entity.
- `attendance` records attendance with both organization and student identity.

`students` uses `(organization_id, student_id)` as its primary key. Student IDs
are assigned within a school, so another organization may use the same value.
Attendance has a composite foreign key to that pair, which makes PostgreSQL
reject an attendance row whose organization and student belong to different
schools.

The original `users.email UNIQUE` constraint is case-sensitive under the
default PostgreSQL text comparison. Migration `003_case_insensitive_user_email.sql`
adds a unique index on `lower(email)`. Before creating it, the migration checks
for existing addresses that collide after case folding and aborts with an
actionable error if any exist. It never changes or removes accounts; operators
must resolve any reported conflicts explicitly, then rerun the migration.

Foreign keys, unique constraints, `NOT NULL` columns, and checks enforce tenant
relationships in the database. Tenant-scoped indexes support membership, role,
staff profile, and attendance lookups. New organization-owned tables should
carry `organization_id` and use composite foreign keys when linking to another
tenant-owned entity.

## Configuration and tests

`loadConfig` accepts only `development`, `test`, and `production`, validates
`API_PORT` as an integer TCP port, and keeps the local defaults for development
and test. Production requires a valid PostgreSQL `DATABASE_URL` and an explicit
HTTPS `CORS_ORIGIN` consisting only of a scheme, host, and optional port.

Copy `apps/api/.env.example` to a local environment file and set `DATABASE_URL`
to a PostgreSQL database. Never put real credentials in the example file.
PostgreSQL integration tests run with `DATABASE_URL` set; without it, the suite
is reported as skipped. Use a dedicated test database because the tests apply
the project's migrations and create temporary fixture rows.

## Authentication foundation

Migration `002_authentication.sql` adds global `users.account_status` (existing
accounts default to `active`) and a nullable Argon2id `password_hash`, plus
`user_sessions`. Session tokens are 256-bit random values sent only in an
HttpOnly, SameSite=Strict cookie with `Path=/` and a seven-day `Max-Age`;
production cookies include `Secure` and no `Domain` attribute is set. PostgreSQL
stores only their SHA-256 token digest, creation/expiry timestamps, and
revocation timestamp. Passwords use Argon2id via the `argon2` package. There is
no registration or password-reset
flow yet, so accounts need a password hash assigned through a trusted
provisioning path before login.

Login and logout require a JSON request from the configured `CORS_ORIGIN` and
validate its `Origin` header. SameSite=Strict is an additional browser defense,
not a replacement for origin validation. The deployment must terminate HTTPS
and must not expose the API over plaintext HTTP. Login returns the same
`invalid_credentials` error for unknown emails,
disabled users, users without password hashes, and wrong passwords. A
process-local IP limiter allows ten attempts per 15 minutes. Forwarded client
IP information may be used only when the API is behind an explicitly trusted
proxy that strips client-supplied forwarding headers and supplies authoritative
values; never trust `X-Forwarded-For` directly from clients. The deployment
gateway should enforce authoritative distributed rate limiting. The in-process
limiter is defense-in-depth only: its state is local to one process, so multiple
API instances and process restarts must not be treated as protected by it.

`GET /v1/auth/session` validates token expiry, revocation, and current global
account status on every request. Its response contains only the authenticated
user ID. There are currently no protected organization API endpoints. Any
future organization-scoped endpoint must derive identity from this validated
server-side session, then check active membership and role/permission for the
requested organization on the server. Client-supplied organization IDs or roles
are never proof of membership or authority. The session response intentionally
does not include organization membership or role information. Consider the
`__Host-` cookie prefix if deployment constraints support its requirements;
the current deployment model does not require changing the cookie name.
