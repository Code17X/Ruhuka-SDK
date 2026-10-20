# Permission Catalog and Role Matrix

## Purpose and status

This document proposes the initial authorization permission catalog and
membership role-to-permission policy for Ruhuka. It complements
[`authorization.md`](authorization.md), which defines the security contract and
decision flow. This is a design contract only: it does not add routes,
authorization code, policy persistence, schema changes, or grants to existing
accounts.

The catalog is forward-looking. The API currently has no organization-scoped
resource routes. A route or tool must name its required `resource.action`
permission and enforce the independently evaluated scope before it is
implemented. Unlisted actions and resources are denied until explicitly
reviewed and added here.

## Naming and evaluation

Permission names use lowercase singular resource names and a dot-separated
action, for example `attendance.read`. The action describes the operation, not
the UI control or HTTP method. Suggested actions are:

- `read`: retrieve or list records (list results must be filtered by scope).
- `create`: create a record, with all referenced records checked in scope.
- `update`: change a record, checking both its current and resulting tenant
  and scope relationships.
- `delete`: remove a record where the product supports deletion.
- `manage`: a narrow administrative operation on access configuration, such
  as membership roles. It does not imply unrelated data access.

Every permission is evaluated for an active membership in the requested
organization. The matrix describes which membership roles contribute a
permission; it never bypasses organization isolation, active membership,
record scope, or deny-by-default behavior. Multiple roles contribute the
union of their individual grants. A role combination does not imply a broader
scope than the grants explicitly provide.

The scope labels below are relationship requirements, not a final shared
`PermissionScope` vocabulary. `own_user`, `linked_student`, and
`assigned_class` describe relationships needed to implement the contract, but
the current shared type contains `self`, `assigned`, `group`, `department`,
and `organization`. This document does not rename that type or settle the
canonical encoding. An implementation must resolve that vocabulary in a
separate decision before encoding policy.

## Initial resource catalog

| Resource | Proposed actions | Notes |
| --- | --- | --- |
| `organization` | `read`, `update` | `read` is limited to the current organization context; `update` changes organization settings, not organization membership or user data. Creation/deletion are provisioning or lifecycle operations and are out of this initial catalog. |
| `membership` | `read`, `create`, `update`, `manage` | `update` covers supported relationship status changes. `manage` covers assigning/removing roles for memberships. It does not let the actor grant themselves access or exceed the centrally configured role policy. Membership reads and changes are organization-bound. |
| `user` | `read`, `update` | Global identity data. Organization roles do not grant general access to a user's global account or credentials. `update` is limited to the user's own profile fields; credential and account-status operations remain separate trusted flows. |
| `student` | `read`, `create`, `update` | Organization-owned student/client records. No delete permission initially. Client access is only to the one student linked to that client membership; staff access is limited to students in explicitly assigned classes. |
| `class` | `read`, `create`, `update` | Organization-owned class records and their ordinary descriptive fields. No delete permission initially. Staff may read assigned classes; class creation or edits are administrative. Managing staff-class assignment is not represented by ordinary class update and needs an explicit assignment operation/model. |
| `attendance` | `read`, `create`, `update` | Organization-owned attendance records. Client access is limited to their linked student; staff access is limited to students in explicitly assigned classes. No delete permission initially; corrections use `update` and should be attributable. |
| `staff_profile` | `read`, `create`, `update` | Organization-specific staff details. Staff can read/update their own profile; administrators can manage profiles in their organization. This resource is included because it already exists in the database foundation. |
| `ai_session` | `read`, `create` | Organization-scoped product sessions, if/when persisted. A session is visible only to its owner or another role explicitly granted access to the corresponding underlying records. No generic transcript access is implied by other data permissions. |
| `ai_tool` | `execute` | Names an allowlisted server-side tool operation. Each tool must also declare and check the underlying resource permissions and scopes for every read or mutation. This permission alone is never direct database access or a way to bypass those checks. |
| `audit_log` (conditional) | `read` | Include only if an audit-log resource is introduced. Read access is organization-bound and intended for authorized administrators. No `create`, `update`, or `delete` permission is exposed through ordinary application authorization; audit events are server-generated and append-only. |

### Resource boundary notes

- `membership.manage` is the single catalog action for role assignment and
  removal. It requires a policy-constrained target role and must not permit
  privilege escalation. A future dedicated `membership_role` resource may be
  preferable if role assignment becomes independently addressable.
- Staff-to-class assignments and client-to-student links are trusted
  relationships that determine scope. They are not caller-editable merely
  because the caller can update a `class` or `student` record. Their schema
  and management operations require a separate design decision.
- `organization` is the tenant context for scoped resources. A permission on
  one organization never carries to another organization.
- The current route set has no organization-scoped resource routes. These
  entries describe planned capabilities and grant no access to existing
  endpoints.

## Initial role-to-permission matrix

`—` means the role contributes no grant for that permission. A named scope is
an explicit grant requirement and remains subject to the scope-vocabulary
decision above. All grants are limited to the same organization as the active
membership.

| Permission | Admin | Staff | Client |
| --- | --- | --- | --- |
| `organization.read` | `organization` | `organization` | `organization` |
| `organization.update` | `organization` | — | — |
| `membership.read` | `organization` | — | — |
| `membership.create` | `organization` | — | — |
| `membership.update` | `organization` | — | — |
| `membership.manage` | `organization` | — | — |
| `user.read` | `own_user` | `own_user` | `own_user` |
| `user.update` | `own_user` | `own_user` | `own_user` |
| `student.read` | `organization` | `assigned_class` | `linked_student` |
| `student.create` | `organization` | — | — |
| `student.update` | `organization` | — | — |
| `class.read` | `organization` | `assigned_class` | — |
| `class.create` | `organization` | — | — |
| `class.update` | `organization` | — | — |
| `attendance.read` | `organization` | `assigned_class` | `linked_student` |
| `attendance.create` | `organization` | `assigned_class` | — |
| `attendance.update` | `organization` | `assigned_class` | — |
| `staff_profile.read` | `organization` | `own_user` | — |
| `staff_profile.create` | `organization` | — | — |
| `staff_profile.update` | `organization` | `own_user` | — |
| `ai_session.read` | `organization`* | `own_user`* | `own_user`* |
| `ai_session.create` | `organization` | `own_user` | `own_user` |
| `ai_tool.execute` | Explicit per-tool policy** | Explicit per-tool policy** | Explicit per-tool policy** |
| `audit_log.read` (conditional) | `organization` | — | — |

\* `ai_session.read` is limited to data the role is independently authorized to
see. Admin visibility into an AI session must not expose underlying records
outside the admin's explicit grants.

\** A role receives `ai_tool.execute` only for an allowlisted tool whose
underlying resource permissions and scopes it already has. The table does not
grant blanket tool execution. Tools that only provide non-sensitive assistance
may have a separately reviewed policy.

## Explicit exclusions and deferred decisions

- The `visitor` role is present in the current shared/database types but is not
  included in this initial role matrix. Its intended behavior must be decided
  before it receives any permission; until then it contributes no grants.
- Current membership states include `pending` and `ended` in addition to
  `active` and `suspended`. This matrix does not change their treatment or
  authorize them. Follow the status decision and migration review recorded in
  [`authorization.md`](authorization.md).
- Canonical scope names and their representation remain unresolved. In
  particular, the matrix's `own_user`, `linked_student`, and `assigned_class`
  relationships do not map one-to-one to the existing `PermissionScope` type.
- This matrix is a proposed initial policy. It does not grant global
  administrator access, account credential management, user suspension,
  student deletion, class deletion, attendance deletion, or role-policy
  editing.
- Authorization policy persistence, class assignments, client-student links,
  and audit-log storage are schema/design work for later reviewed batches.

## Review gate before implementation

Before implementing middleware or protected resource routes, review this
catalog against the concrete operations and data model, resolve the scope
vocabulary, decide `visitor` and the non-active membership states, and approve
any additions or changes to the role matrix. Each route and AI tool must then
declare a permission and data scope, enforce both centrally, and fail closed
when authoritative policy or relationship data is unavailable.
