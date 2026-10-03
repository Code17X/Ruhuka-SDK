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

Foreign keys, unique constraints, `NOT NULL` columns, and checks enforce tenant
relationships in the database. Tenant-scoped indexes support membership, role,
staff profile, and attendance lookups. New organization-owned tables should
carry `organization_id` and use composite foreign keys when linking to another
tenant-owned entity.

## Configuration and tests

Copy `apps/api/.env.example` to a local environment file and set `DATABASE_URL`
to a PostgreSQL database. Never put real credentials in the example file.
PostgreSQL integration tests run with `DATABASE_URL` set; without it, the suite
is reported as skipped. Use a dedicated test database because the tests apply
the project's migrations and create temporary fixture rows.
