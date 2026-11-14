# Adaptable organizations

The API stores domain records in `entities` and links in `relationships`. Each
organization owns its type definitions, role catalog, permission catalog, and
grants. Education is an imported template, not a requirement of the runtime.

## Deployment order

1. Complete Migration 012 first. Stop the API and any legacy education writers
   during the cutover so the import sees a stable snapshot.
2. Paste the whole `apps/api/migrations/013_adaptable_organizations.sql` file into
   the Supabase SQL Editor. It is an atomic transaction and records version 013.
   Do not use the old Node migration runner for this manual migration.
3. Start the updated API. In this Windows environment `DATABASE_URL` must use the
   Supabase transaction pooler at `aws-0-eu-north-1.pooler.supabase.com:6543`.
   Supply credentials through the environment; do not put them in source control.
   Keep `PUBLIC_ORIGIN` at the public Portal/API origin, or localhost:3000 for local
   development. Existing CORS, cookie, and argon2 behavior is retained.
4. Run the PowerShell script below. The test account's existing password hash,
   membership, and admin role are preserved; no password is reset by migration 013.
5. Review the migration verification SQL and the created resources. Resume API use
   only after the checks pass. The old education and global policy tables are
   retained snapshots; writes there no longer update the generic model.

```powershell
# From the monorepo root. PowerShell 7; defaults to teacher@test.com/password123.
./scripts/test-adaptability.ps1

# Repeat a run when patient/doctor definitions already exist:
./scripts/test-adaptability.ps1 -AllowExisting

# Only login/profile/logout; creates no configuration resources.
./scripts/test-adaptability.ps1 -AuthOnly

# Through the same-origin HTTPS reverse proxy:
./scripts/test-adaptability.ps1 -BaseUrl https://portal.example.com -Origin https://portal.example.com
```

The script creates `patient`, `doctor`, and `patient.read`, then grants the permission
to doctor with `assigned_entity` scope. It verifies profile and configuration-write
denial under another organization header, rechecks the original profile, and logs
out even after a failure. Supply `-OtherOrganizationId` with an existing organization
the test user cannot access to test two real tenants; otherwise it uses a random UUID.
Definitions remain for inspection. `-AllowExisting` reports duplicate creations as
yellow warnings; it does not claim they were newly created. Errors print in red and
exit with code 1. `ADAPTIVE_TEST_PASSWORD` or `-Password` overrides the test password.
`-AuthOnly` performs just login/profile/logout. The script does not assign doctor to
the test user or grant patient access to admin.

## Storage and migration behavior

`entity_types` records a key, display name, and JSON schema metadata. `entities`
stores an object in `data`, its type, tenant, and timestamps. Type keys use lowercase
letters, numbers, and underscores. Metadata is stored as an object; the configuration
API does not claim to implement a JSON Schema validation engine or record CRUD.

`relationship_types` optionally restricts source and target entity types.
`relationships` stores the directed edge, JSON context, and an `active` flag.
Composite foreign keys prevent cross-tenant endpoints, catalog references, and
grants. A trigger checks endpoint types; entity tenant/type are immutable.

Legacy students, classes, departments, attendance, staff profiles, memberships,
and optional teachers/parents become entities. Their original rows are retained in
`data`, with `legacy_source` and `legacy_id` identifying the source. UUID and text
student identifiers both become source strings; new generic entity IDs are UUIDs.
Legacy links, assignments, enrollments, and attendance ownership become generic
relationships. Context preserves term, status, timestamps, and source IDs.
Non-active enrollments migrate as inactive edges and cannot confer access.
Unresolved or cross-tenant legacy references abort the whole migration.

The test organization `cf463143-ab36-4fad-820b-bca37723a1ef` receives education
definitions and an organization-owned copy of existing roles and grants. All
existing organizations receive separate catalog copies. `admin` gets the reserved
`org.configure` permission; all roles retain baseline `user.read/own_user`.

The migration does not drop or alter `user_sessions`, `audit_log`, `organizations`,
`users`, `memberships`, or `membership_roles`. It cannot be applied twice; the
ledger guard prevents a stale snapshot import from overwriting later changes.

## Authentication and role binding

Requests use the existing HttpOnly session cookie and `X-Organization-Id`. Global
identity/session lookups stay global; domain and policy queries are tenant scoped.
An active membership is required. Login alone is not organization access.

Legacy `membership_roles.role` keys resolve against `organization_roles` for that
membership's organization. New arbitrary roles use `organization_membership_roles`,
which avoids changing the legacy table's role CHECK constraint. Defining a role
does not assign it to anyone. Use a trusted administrative SQL transaction to bind
an existing membership to a custom role:

```sql
-- Replace both UUIDs and the role key with reviewed values.
INSERT INTO public.organization_membership_roles
  (organization_id, membership_id, role_id)
SELECT m.organization_id, m.id, r.id
FROM public.memberships m
JOIN public.organization_roles r ON r.organization_id = m.organization_id
WHERE m.organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
  AND m.id = '00000000-0000-0000-0000-000000000001'
  AND r.role_key = 'doctor'
ON CONFLICT DO NOTHING;
```

New organizations must be provisioned with organization-owned `admin`, `user.read`,
and `org.configure` entries and their initial administrator binding before using
configuration endpoints. Trusted provisioning can run
`SELECT public.bootstrap_organization_configuration('<organization UUID>');`
and then the role-binding SQL above with the initial administrator's membership
and role key `admin`. The bootstrap is idempotent and does not assign roles itself.
The reserved `admin` role is organization-local.
Creating a new role through the API automatically grants its own-profile permission.
Permissions never implicitly grant themselves to admin; each subsequent custom
permission needs an explicit grant.

## Authorization and scopes

`requirePermission(pool, { userId, organizationId, permission })` keeps its signature
and unions scopes from the caller's roles in that organization. It never consults
the old global grants after cutover. Storage errors deny access.

| Scope                                 | Meaning                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `organization`                        | Any resource in the explicitly selected organization                               |
| `own_user`                            | The user's own profile; for generic entities, only their trusted membership anchor |
| `assigned_entity`                     | Direct active `assigned_to` targets from the membership anchor                     |
| `linked_entity`                       | Direct active `linked_to` targets from the membership anchor                       |
| `path:out.treats`                     | Follow active `treats` edges forward from the membership anchor                    |
| `path:out.assigned_to/in.enrolled_in` | Assigned class, then students whose enrollment points to that class                |

Paths contain one to four `out.<type>` or `in.<type>` steps separated by `/`.
Every step stays within the tenant; inactive edges do not confer access. The API
checks that relationship types in a grant exist in the selected organization.
Unknown scopes fail validation. No wildcard or unbounded traversal exists.

The mapping in `membership_entities` establishes the authenticated graph anchor.
Caller-controlled fields such as `data.user_id` never establish authorization.
Trusted provisioning must create an anchor and mapping for new memberships that
need relationship-scoped access by calling
`SELECT public.ensure_membership_entity('<organization UUID>', '<membership UUID>');`.
This idempotent helper checks tenant ownership, locks the membership during creation,
and returns the anchor's UUID. Both provisioning helpers use invoker privileges and
have PUBLIC execute permission revoked; call them from the SQL Editor or a suitably
privileged backend, not the browser. Existing memberships receive anchors in 013.

`getLinkedEntityIds(pool, membershipId, relationshipType, organizationId?)` and
`getAssignedEntityIds(...)` return direct active target IDs. Pass the authenticated
membership, never a client-selected membership ID; pass the organization when
already known. `canAccessEntity` combines a permission grant, tenant existence,
and the scope traversal. It requires an `entityType` selected by the trusted handler
alongside its permission key; it rejects IDs of other types. Data handlers must
bind that pair in server code and filter every data query by tenant. A permission name
is an opaque policy key, not a schema inferred by splitting a string.

The AI assistant is not implemented. A future trusted executor can load the
organization's type definitions, map allowlisted tools to explicit permission
keys, and use these helpers before reading resources. `checkToolPermission`
accepts a server-owned tool-to-permission map and denies unknown tools. Browser
or model input must never supply that trusted map.

## Configuration API reference

All five POST routes require JSON, the trusted Origin, a session cookie,
`X-Organization-Id`, active membership, the `admin` role, and an organization-scoped
`org.configure` grant. Tenant selection comes only from the header. Unknown body
fields are rejected. Responses use database field names and include `id` and
`organization_id`.

| Endpoint                     | Request body                                                                                                                 | 201 response fields beyond id/organization_id                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/v1/org/entity-types`       | `{ "key": "patient", "displayName": "Patient", "schema": {} }`                                                               | `type_key`, `display_name`, `schema_definition`                  |
| `/v1/org/relationship-types` | `{ "key": "appointment_for", "displayName": "Appointment for", "fromEntityType": "appointment", "toEntityType": "patient" }` | `type_key`, `display_name`, `from_entity_type`, `to_entity_type` |
| `/v1/org/roles`              | `{ "key": "doctor", "displayName": "Doctor" }`                                                                               | `role_key`, `display_name`                                       |
| `/v1/org/permissions`        | `{ "key": "patient.read", "description": "Read permitted patients" }`                                                        | `permission_key`, `description`                                  |
| `/v1/org/role-permissions`   | `{ "roleKey": "doctor", "permissionKey": "patient.read", "scope": "assigned_entity" }`                                       | `role_id`, `permission_id`, `scope`                              |

`schema`, `description`, and the endpoint type restrictions are optional. Keys are
1–64 characters; permission keys are 1–128 and also allow dots. Display names are
1–120 characters; descriptions are at most 2,000 characters. Request bodies retain
the existing 16 KiB maximum. A role may have several scopes for one permission.

`GET /v1/org/permissions/check?permission=patient.read` evaluates only the current
user's grant in the selected organization. It returns `{ "granted": true,
"scopes": ["assigned_entity"] }` or `{ "granted": false }`. It is included so the
integration script can observe new grants through the actual authorization path.
It does not expose another user's permissions or authorize a particular entity.

Errors: 400 invalid input, 401 no valid session, 403 insufficient access/origin,
404 unknown role or permission for a grant, 409 duplicate definition/grant,
413 oversized body, 415 unsupported content type, 422 invalid relationship/type
reference, and 500 infrastructure/audit failure.

## Audit semantics

Configuration checks and writes share one database connection and transaction.
`auditAuthorizationDecision(..., true)` runs before any business mutation. Any
audit write error—including constraint failures—produces a generic HTTP 500 and
rolls back the mutation. Successful configuration writes and their grant audit
commit together. Authorization denials are audited and committed before HTTP 403.
Invalid input and failed business inserts roll back their tentative grant audit.
Read audits use false and remain best-effort. Logs do not expose raw database errors.

## Domain examples

Apply each sequence to the desired organization, with its admin session/header.
Definitions are independent across organizations; the same key can mean different
things in different tenants.

### Education

Define `student` and `class` entity types. Define `enrolled_in` from student to class,
and `assigned_to` from a membership anchor to class. Create `teacher` and
`student.read`, then grant `path:out.assigned_to/in.enrolled_in`. Create a `parent`
role with `attendance.read` scoped to `path:out.linked_to/in.attendance_for`.
Migration 013 imports these equivalents for existing education data and grants.

### Healthcare

POST entity types `{ "key": "patient", "displayName": "Patient" }`,
`{ "key": "appointment", "displayName": "Appointment" }`, and
`{ "key": "medical_record", "displayName": "Medical record" }`.
Define `treats` with source `membership` and target `patient`, `appointment_for`
from appointment to patient, and `record_for` from medical_record to patient.
Create `doctor`; create `patient.read` and `medical_record.read`.
Grant doctor `patient.read` with `path:out.treats` and `medical_record.read` with
`path:out.treats/in.record_for`. Bind the doctor membership to that role and create
trusted `treats` relationships for their assigned patients.

### Legal

Define `case`, `client`, and `document` entity types. Define `assigned_to` from
membership to case, `represents` from case to client, and `document_for` from
document to case. Create `lawyer`; create `case.read`, `client.read`, and
`document.read`. Grant them `assigned_entity`,
`path:out.assigned_to/out.represents`, and
`path:out.assigned_to/in.document_for`, respectively. A case assignment controls
the bounded traversal without granting organization-wide document access.

## Verification and disposable test cleanup

```sql
SELECT name, applied_at FROM public.schema_migrations
WHERE name = '013_adaptable_organizations.sql';

SELECT r.role_key, p.permission_key, rp.scope
FROM public.organization_role_permissions rp
JOIN public.organization_roles r ON r.organization_id = rp.organization_id AND r.id = rp.role_id
JOIN public.organization_permissions p ON p.organization_id = rp.organization_id AND p.id = rp.permission_id
WHERE rp.organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
ORDER BY r.role_key, p.permission_key, rp.scope;

SELECT legacy_source, count(*) FROM public.entities
WHERE organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
GROUP BY legacy_source;
SELECT legacy_source, count(*) FROM public.relationships
WHERE organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
GROUP BY legacy_source;
```

Cleanup for older versions of the script only: replace `smoke_REPLACE` with the
exact disposable key printed by that older run. The restored script uses the
patient/doctor keys and does not automatically delete those domain definitions.
Deleting the disposable permission also removes its admin grant; production
permissions, roles, entities and audit history are not affected.

```sql
BEGIN;
DELETE FROM public.organization_permissions
WHERE organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
  AND permission_key = 'smoke_REPLACE.read';
DELETE FROM public.organization_roles
WHERE organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
  AND role_key = 'smoke_REPLACE';
DELETE FROM public.relationship_types
WHERE organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
  AND type_key = 'smoke_REPLACE';
DELETE FROM public.entity_types
WHERE organization_id = 'cf463143-ab36-4fad-820b-bca37723a1ef'
  AND type_key = 'smoke_REPLACE';
COMMIT;
```

Automated verification uses PGlite, an isolated PostgreSQL engine, real argon2
password hashes, and HTTP login/profile requests. It applies 012 and 013, tests
all configuration routes, custom role bindings, relationship scopes, tenant
isolation, inactive memberships/enrollments, and forced audit failures. It never
connects to the live Supabase database:

```powershell
pnpm --filter @adaptive/api exec tsx --test src/adaptability.integration.test.ts
```
