# Authorization Schema Design

## Purpose and status

This is a schema design only. It proposes no migration files, code, shared-type
changes, or data changes. The design follows the authorization contract in
[`authorization.md`](authorization.md), the proposed policy in
[`permission-catalog.md`](permission-catalog.md), and the decisions in
[`authorization-decisions.md`](authorization-decisions.md).

The API migrations are explicit PostgreSQL SQL files applied in lexicographic
filename order and recorded in `schema_migrations`. Existing migrations use
UUID primary keys, `gen_random_uuid()`, `TIMESTAMPTZ` timestamps, named indexes,
checks, and composite foreign keys to preserve organization boundaries.
Migration `001_database_foundation.sql` already creates `memberships`,
`membership_roles`, `staff_profiles`, organization-scoped `students`, and
`attendance`; `002_authentication.sql` adds `user_sessions`; `003` adds
case-insensitive email uniqueness. In particular, multi-role membership
storage already exists in migration 001 and is not a new table to duplicate.

Every item marked **Open question** below needs an explicit answer before its
associated implementation or migration is finalized.

## Design principles

- Authorization reads current authoritative database state for each request;
  there is no authorization cache. Missing, invalid, or unavailable policy or
  relationship data denies the request.
- A grant exists only as an explicit `role_permission` row. Absence means deny.
  No role name, membership state, or combination of narrower scopes creates an
  implicit grant.
- All organization-owned relationships use `organization_id` and composite
  foreign keys where needed to prevent cross-tenant references.
- `pending`, `ended`, and `suspended` memberships are ineligible and receive
  zero grants. `visitor` is a non-member state, not a membership role, and
  receives zero grants. Existing rows must be reviewed before constraints or
  conversion are considered.
- Relationship rows that determine scope are trusted server-managed data.
  They must not be writable through ordinary client profile, class, or student
  update operations.

## Table and constraint sketches

These are logical PostgreSQL sketches; exact types and names may be adjusted
when migration work is reviewed. They do not constitute executable migration
SQL.

### 1. Multi-role memberships — existing `membership_roles`

Migration 001 already provides the required one-membership-to-many-roles
relation:

| Column | Proposed shape | Purpose / constraint |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Row identity. |
| `organization_id` | `UUID NOT NULL` | Tenant key. |
| `membership_id` | `UUID NOT NULL` | Membership owning the role. |
| `role` | `TEXT NOT NULL` | Currently checked against `visitor`, `client`, `staff`, `admin`. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Assignment creation time. |

Existing constraints include composite FK `(organization_id, membership_id)`
to `memberships (organization_id, id) ON DELETE CASCADE`,
`UNIQUE (membership_id, role)`, and an organization/membership lookup index.
This permits different roles on one membership and prevents duplicate copies
of one role. Do not add a second membership-role table.

The policy design below introduces a normalized `roles` catalog. A later
migration may replace or supplement the current `role TEXT` with `role_id`
referencing that catalog, retaining the tenant-scoped membership FK and
uniqueness guarantee. If retaining `role` text, the system must still enforce
that each stored value maps to a catalog role; application-only mapping would
be weaker.

**Open question:** Should migration work convert `membership_roles.role` to a
`role_id` FK, or retain the text column with a database-enforced catalog
reference strategy? Decide handling of any legacy `visitor` assignment only
after the data review below.

### 2. Client-to-student link — `client_student_links`

One trusted link per client membership per organization, with no student
sharing prohibition implied by this model:

| Column | Proposed shape | Purpose / constraint |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Link identity. |
| `organization_id` | `UUID NOT NULL` | Tenant key. |
| `membership_id` | `UUID NOT NULL` | Client membership. |
| `student_id` | `TEXT NOT NULL` | Organization-local student key. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Trusted link lifecycle timestamps. |

Constraints: composite FK `(organization_id, membership_id)` to
`memberships (organization_id, id) ON DELETE CASCADE`; composite FK
`(organization_id, student_id)` to `students (organization_id, student_id)`
with deletion behavior chosen to preserve referential integrity; and
`UNIQUE (organization_id, membership_id)` to enforce at most one student per
client membership per organization. A uniqueness constraint on
`(organization_id, membership_id, student_id)` is redundant under that
cardinality constraint. An index beginning with `(organization_id,
student_id)` may support reverse lookup if needed.

The constraint guarantees at most one link, not that the referenced
membership has the `client` role. Role eligibility must be validated by the
trusted assignment workflow / authorization layer unless a reviewed database
mechanism is introduced. No client-supplied identifier can create or change
this relationship.

**Answered:** Student records may be shared across different client
memberships. Deleting a student is restricted (`ON DELETE RESTRICT`) while a
client-student link exists. The privileged workflow for managing links remains
an open question.

### 3. Staff-to-class assignment — `staff_class_assignments`

Trusted assignment records define `assigned_class` scope. The current schema
has no `classes` table, so this relationship depends on a separately designed
organization-scoped class entity.

| Column | Proposed shape | Purpose / constraint |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Assignment identity. |
| `organization_id` | `UUID NOT NULL` | Tenant key. |
| `membership_id` | `UUID NOT NULL` | Staff membership receiving assignment. |
| `class_id` | `UUID NOT NULL` (or tenant-local class key) | Assigned class. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Assignment creation time. |

Constraints: composite FK `(organization_id, membership_id)` to
`memberships (organization_id, id) ON DELETE CASCADE`; composite FK from
`(organization_id, class_id)` to the eventual class key; and
`UNIQUE (organization_id, membership_id, class_id)`. Add indexes for both
staff-to-class authorization lookup and class-to-staff administration lookup.
Assignment mutation is a trusted administrative operation and must be audited
if/when audit persistence is designed. A caller's class ID never establishes
an assignment.

**Open question:** The class table and primary-key shape are not in the current
migration set. Decide their schema and deletion behavior before implementing
this assignment FK. Which authorized workflow manages assignments, and is
assignment history required (effective dates / revocation records) or is
current-state deletion sufficient?

### 4. Staff-to-department assignment — `staff_department_assignments`

`department` is canonical vocabulary for the staff portal but no catalog
permission currently uses this scope. Keep its relationship model separate
from the class assignment model; creating it does not grant any current
permission.

| Column | Proposed shape | Purpose / constraint |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Assignment identity. |
| `organization_id` | `UUID NOT NULL` | Tenant key. |
| `membership_id` | `UUID NOT NULL` | Staff membership. |
| `department_id` | `UUID NOT NULL` (or tenant-local key) | Department assigned. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Assignment creation time. |

Constraints: composite FK `(organization_id, membership_id)` to
`memberships (organization_id, id) ON DELETE CASCADE`; composite FK to an
organization-scoped department entity; and
`UNIQUE (organization_id, membership_id, department_id)`. Index assignment
lookup in both directions. Do not add a `department` grant to any role as
part of this schema design.

**Open question:** No department entity currently exists. Decide whether to
introduce an organization-scoped `departments` table or reference an existing
future entity, its key and lifecycle, and whether assignments are current
state or effective-dated history. Any permission using department scope needs
a separate catalog and policy approval.

### 5. Persisted authorization policy

Use three normalized catalogs. Keep policy rows centrally managed, with no
organization key unless a future explicit decision introduces tenant-specific
overrides. Migration 004 seeds the approved catalog and matrix in
`permission-catalog.md`; `ai_tool.execute` is per-tool policy outside this
table, and conditional `audit_log` receives no rows.

#### `permissions`

| Column | Proposed shape | Purpose / constraint |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Stable permission identity. |
| `key` | `TEXT NOT NULL UNIQUE` | Canonical `resource.action`, e.g. `student.read`. Check non-empty and canonical format. |
| `description` | `TEXT NOT NULL` | Human-readable capability description. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Catalog lifecycle. |

#### `roles`

| Column | Proposed shape | Purpose / constraint |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Stable role identity. |
| `key` | `TEXT NOT NULL UNIQUE` | Catalog membership role key such as `admin`, `staff`, or `client`. |
| `description` | `TEXT NOT NULL` | Human-readable role meaning. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Catalog lifecycle. |

The decided `visitor` state is not a role row. It must not be seeded or
converted into a membership grant. Role deletion should be restricted while
referenced by memberships or grants; retirement can be represented explicitly
if lifecycle support is needed.

#### `role_permissions`

| Column | Proposed shape | Purpose / constraint |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY` | Grant identity. |
| `role_id` | `UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT` | Role receiving this policy grant. |
| `permission_id` | `UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT` | Capability granted. |
| `scope` | `TEXT NOT NULL` | One canonical scope: `own_user`, `linked_student`, `assigned_class`, `department`, or `organization`. |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Grant lifecycle. |

Constraint `UNIQUE (role_id, permission_id, scope)` prevents duplicate grants.
Add indexes for role-to-grants lookup and permission lookup. Scope should have
a check constraint for the canonical vocabulary. `department` is supported as
vocabulary, but must not have grants until a reviewed catalog permission
explicitly uses it. The authorization read for a request must join the active
membership's role rows to `roles`, `role_permissions`, and `permissions` and
read the scope relationships in the same request; no cache is permitted.
Missing rows, unknown role/permission/scope, or query failure deny access.

**Open question:** Should grants be represented as multiple rows per
role/permission (one per explicit scope, as sketched), or as one row with a
scope array? Multiple normalized rows are recommended for simple constraints
and querying. Also decide whether a policy revision/audit history table is
required before production policy editing; neither table is specified here.

### Scope behavior boundary

The grant's `scope` selects a trusted relationship or organization boundary; it
does not encode arbitrary predicates. `own_user` resolves from the
membership's `user_id`; `linked_student` resolves through
`client_student_links`; `assigned_class` resolves through
`staff_class_assignments` and class/student relationships; `department`
resolves through `staff_department_assignments` only for a future approved
permission; `organization` is constrained to the requested organization.
Every resource lookup must independently preserve tenant boundaries.

## Data-review plan before state enforcement

No migration may silently activate, delete, or convert memberships or role
assignments. Before adding constraints or changing the membership-role model,
perform a read-only inventory and record review results for operator approval.

1. Count and export (through an approved secure process) membership rows by
   `status`, organization, and creation/update timestamps; specifically
   inspect all `pending` and `ended` rows and their associated user and role
   assignments. Do not expose password/session secrets in review extracts.
2. Inventory role rows with `role = 'visitor'`, including memberships' status
   and organization. Identify any other unknown or malformed role values if a
   normalization migration is planned.
3. Classify each pending/ended/visitor case as confirmed lifecycle state,
   invalid combination, or ambiguous; document evidence and accountable owner.
4. Obtain explicit remediation decisions for ambiguous/invalid rows. Preserve
   a before/after mapping and reason for every approved change. Do not infer
   activation from a role, a login, recent activity, or organization presence.
5. If cleanup or mapping is approved, perform it as an explicitly reviewed,
   separately auditable data operation with counts and rollback/recovery plan.
   Constraint migrations must first run non-mutating preflight checks and fail
   with actionable diagnostics if unresolved rows remain.
6. After review, confirm the policy layer denies all non-`active` memberships
   regardless of remaining roles. Role cleanup and status enforcement are
   distinct actions.

**Open question:** Who owns the review, which secure export/review mechanism
and retention period will be used, what evidence is sufficient to classify a
row, and who approves each remediation? No data change proceeds until these
owners and decisions are documented.

## Migration ordering proposal

The next available migration number is `004`, following the existing explicit
lexicographic SQL naming convention. These are proposed steps only; do not
create migration files in this batch. Each step should be transactional where
PostgreSQL permits, fail closed on invalid existing data, and include a clear
preflight error. Reversibility describes schema rollback, not automatic
reversal of reviewed data changes.

1. **004 — policy catalogs and explicit grants.** Create `permissions`, `roles`,
   and `role_permissions`, constraints and indexes. Seed only the reviewed
   catalog and matrix in the same migration or a separately versioned seed
   step after approval. Reversible by dropping these new tables only if no
   application depends on them; seed removal is reversible only when it does
   not remove subsequently edited policy.
2. **005 — membership role catalog reference.** After visitor and existing
   role rows have been reviewed, seed approved role catalog entries, add and
   backfill `role_id` from existing `membership_roles.role`, verify every row,
   then add FK/unique constraints. Drop the legacy text column only in a later
   reviewed step after application compatibility is established. Reversible
   while preserving the legacy column; destructive column removal is not
   reversibly safe without retained data/backup.
3. **006 — client student links.** Create `client_student_links`, composite
   tenant FKs, one-link unique constraint, and lookup indexes. Reversible by
   dropping the new table; any subsequently entered links require export or
   backup before rollback.
4. **007 — class foundation, if not already introduced.** Define the
   organization-scoped class table/key and its relationship to students (the
   exact class/student model is an open prerequisite). Reversible while no
   dependent assignment or product data exists; otherwise rollback needs
   preserving those rows.
5. **008 — staff class assignments.** Create assignments and tenant FKs,
   unique constraint, and lookup indexes once the class key exists. Reversible
   by dropping the new table after preserving any assignment data.
6. **009 — department foundation and staff assignments.** Define the
   organization-scoped department entity if approved, then create
   `staff_department_assignments` with tenant FKs, unique constraint, and
   indexes. Reversible by dropping the new assignment table and then its
   department table only when no dependent data remains.

The steps may be split into smaller migrations but must retain dependency
order. Each should have an explicit rollback note in its review. Existing
migration files remain immutable under the current migration runner; any
correction should be a new forward migration.

**Answered:** Policy catalog seeds are versioned in migration 004. Classes
belong to this work stream and will be designed/implemented in Slice 3, before
staff class assignments. Department foundations remain separate. Rollback and
backup expectations for populated relationship and policy tables remain open.
