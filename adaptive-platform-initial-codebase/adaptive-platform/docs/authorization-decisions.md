# Authorization Decisions

This document records two decisions that resolve open points in
[`authorization.md`](authorization.md) and
[`permission-catalog.md`](permission-catalog.md). It is a design decision only:
it does not change code, shared types, schema, stored grants, or records.

## Decision 1: Canonical scope vocabulary

The canonical vocabulary is `own_user`, `linked_student`, `assigned_class`,
`department`, and `organization`. These names identify the trusted
relationship or grant that bounds a permission. The vocabulary replaces the
ambiguous proposed names `self` and `assigned`; `group` is dropped because no
current catalog relationship or approved policy requires it. A future
relationship type must be proposed explicitly rather than inferred from that
unused name.

| Catalog relationship / grant | Canonical scope | Decision and boundary |
| --- | --- | --- |
| `own_user` | `own_user` | Only the user identity associated with the active membership. It does not grant access to other users' global account or credential data. |
| `linked_student` | `linked_student` | Exactly the one student linked to this client membership, within the same organization. No link means no student access; a caller-supplied student ID cannot establish the link. |
| `assigned_class` | `assigned_class` | Only classes explicitly assigned to this staff membership, within the same organization. Assignment is verified from trusted backend-managed data; a caller-supplied class ID cannot establish it. Student and attendance access under this scope is limited to records in those assigned classes. |
| Department-scoped staff-portal access | `department` | Only departments explicitly assigned to this staff membership, within the same organization. Department-scoped records are limited to those departments; assignment is verified from trusted backend-managed data, never a caller-supplied department ID. No catalog permission may reference this scope until department-scoped permissions are added to docs/permission-catalog.md in a reviewed update. |
| Organization-wide access | `organization` | Records in the one organization named by the active membership and request context. This remains an explicit permission-and-scope grant; role, membership, or combination of narrow grants never widens access implicitly. |

All scopes remain subject to an explicit applicable `resource.action`
permission and the authorization contract's tenant checks. `department` is
retained for the staff portal's department-scoped access; no catalog
permission uses it yet, so it grants nothing today. Updating `PermissionScope`, policy encoding, or
relationship storage is deferred to a later implementation batch; until then,
the existing shared type is unchanged and must not be treated as a complete
encoding of this decision.

## Decision 2: Pending and ended memberships; visitor

Only an `active` membership is eligible for authorization evaluation.
`suspended`, `pending`, and `ended` memberships receive zero grants and are
denied protected organization access regardless of attached roles. Their
intended lifecycle meanings are:

- `pending`: membership requested or provisioned but not yet activated. It
  remains unable to access protected organization resources until an
  authorized activation flow changes its status to `active`.
- `ended`: membership relationship has been terminated. It remains unable to
  access protected organization resources; any later return requires an
  explicit future reactivation or new-membership policy decision.
- `suspended`: membership is temporarily disabled and receives no protected
  access until an authorized status change restores eligibility.

`visitor` is not an organization membership role. It represents a
non-member/unauthenticated visitor state and receives zero organization
permissions or data grants. A user who has a valid global session but no active
membership is still denied organization access; authentication does not
convert `visitor` into a membership. Public routes remain governed by their
explicit public-route contract.

Activation, ending, suspension, reactivation, invitation, and visitor-to-member
flows are future work. No route, transition authority, default grant, or schema
change is specified here.

Before schema alignment, review existing membership rows and role assignments
for `pending` and `ended`, and any persisted `visitor` role assignments. Confirm
whether those records represent the lifecycle meanings above, identify invalid
or ambiguous combinations, and decide record remediation and any migration
mapping. Do not silently activate, delete, or convert records as part of this
documentation decision. Schema constraints and migration follow-up are
deferred to a later batch.
