# Authorization Contract

## Purpose

This document defines the security contract for authorization in Ruhuka. It
describes how the backend decides whether a protected operation may be
performed. It is a design contract, not an implementation: it adds no
authorization middleware, persistence, endpoints, or permission assignments.

Authorization is server-side and deny-by-default. UI visibility, SDK
observations, AI output, and identifiers supplied by a caller do not grant
access.

## Authentication and authorization

Authentication establishes which global user is making a request. The current
session authentication returns the authenticated `userId` after validating the
session and global account status. A valid session does not grant access to any
organization by itself.

Authorization separately determines whether that authenticated user may
perform a particular action on particular records in a particular
organization. Membership, roles, permissions, and scope must be obtained and
evaluated from authoritative backend data and policy. They are not trusted
because a client includes them in a request.

## Authorization decision flow

Before reading or changing protected data, the centralized backend
authorization layer must:

1. Authenticate the request and obtain the server-validated global `userId`.
2. Resolve the requested organization. An organization ID supplied by a client
   is only a selector for the requested tenant.
3. Find the authenticated user's membership in that exact organization and
   require status `active`.
4. Load that membership's roles and the centrally maintained policy applicable
   to the operation.
5. Identify the operation's required `resource.action` permission and require
   an explicit applicable permission grant.
6. Independently determine the allowed data scope from trusted backend-managed
   relationships and require that every target record falls within it.
7. Perform the operation only if every check succeeds. If authorization data
   cannot be retrieved or validated, deny the operation.

Protected routes and tools must use this same centralized layer. The initial
implementation must use authoritative current membership, role, and policy
data without an authorization cache. Membership suspension and role or
permission changes must affect subsequent protected requests. Public routes
must be explicitly identified; every other route denies access unless
authorization succeeds.

## Global user identity and organization membership

A `users` row represents one global identity, independent of any organization.
One user may belong to multiple organizations through separate memberships.
Each membership is that user's organization-specific relationship and carries
its own status and roles. A role or membership in one organization provides no
authority in another.

The authorization contract recognizes these initial membership states:

- `active`: eligible for authorization evaluation, subject to permission and
  data-scope checks.
- `suspended`: ineligible for access in that organization, regardless of
  assigned roles.

Suspending one membership denies access to that organization. It does not
automatically suspend the user's memberships in other organizations. A global
account's active status does not override a suspended organization membership.

The current database schema also permits `pending` and `ended`. This batch does
not change accepted database states or roles. A future migration and data
review must decide how these existing states and records are handled before
the schema is aligned with the initial authorization states.

## Roles and permissions

The initial authorization roles are `admin`, `staff`, and `client`. Roles are
attached to memberships, not global identities. An organization admin is not
a global system administrator.

Roles contribute permissions through an explicit, centrally maintained
role-to-permission policy. A permission represents a capability using
`resource.action` naming, such as `attendance.read` or `student.update`. No
role receives a permission merely because of its name. This document does not
invent the initial permission catalog or role-to-permission matrix; those must
be decided before authorization middleware is implemented.

## Permissions and data scope

Permission and scope are separate checks. A permission identifies the allowed
action; scope limits the records on which that action may be performed. A
permission alone does not grant access to every matching record in an
organization.

Only records covered by an explicit applicable permission-and-scope grant may
be accessed. Multiple roles may contribute permissions and explicit grants.
Combining grants may permit the union of the record sets each grant explicitly
authorizes, but no narrow grant may become broader implicitly. In particular,
organization-wide access requires an explicit grant.

The repository currently defines `PermissionScope` as `self`, `assigned`,
`group`, `department`, and `organization` in `packages/shared/src/index.ts` and
lists the same names in `docs/permissions.md`. Those names do not precisely
express the `own_user` and `assigned_class` relationship concepts used below.
This contract does not silently rename or replace the existing type. The
canonical scope names and their representation remain a decision for a later
implementation batch.

## Role and data boundaries

### Admin

An `admin` membership does not automatically receive organization-wide access.
Organization-wide data access requires an explicit permission-and-scope grant
in the central policy. Any such grant remains confined to its organization;
it never creates global system authority or access to another organization's
records.

### Staff

Staff may access class-scoped data only for classes to which that staff
membership is explicitly assigned. Assignments must come from trusted,
backend-managed data, not a submitted class ID. Staff have no organization-wide
data access unless a separate explicit authorization grant permits it. The
current schema contains `staff_profiles` but does not represent class
assignments; a trusted assignment model is a future schema requirement.

### Client

Each client membership may link to at most one student record per organization.
That relationship must be stored in trusted, backend-managed data and
validated within the same organization. A missing relationship means the
client membership has no student-record access. A client-supplied student ID,
user ID, or organization ID does not establish ownership. The current schema
has organization-scoped `students` but no client-membership-to-student
relationship; its concrete schema design belongs in a separately reviewed
implementation batch and is not named or prescribed here.

## Multi-role memberships

A membership may have multiple roles. Only roles attached to that same active
membership in the requested organization are considered. Permissions from
multiple roles may contribute their explicit grants, but scopes do not widen
implicitly. The applicable record set is limited to the union of records
explicitly authorized by applicable permission-and-scope grants. An
organization-wide record set is possible only through an explicit grant; a
narrower grant cannot become organization-wide through role combination.

## Tenant isolation

Every organization-scoped operation is bound to one requested organization.
The backend must validate active membership in that exact organization and
must constrain each data lookup or change to the same organization. Database
relationships and queries must preserve the tenant boundary. Cross-organization
access is always denied, including when a user is active in one organization
but requests a record from another.

Client-supplied organization IDs may select the requested organization, but
never establish membership or authority. Client-supplied user, student, class,
membership, or other resource IDs may identify requested targets, but never
establish identity, ownership, assignment, or scope.

## AI authorization boundary

AI may request a tool operation, but cannot grant permissions or expand scope.
The backend must authorize the action and target records independently of
AI-generated arguments, then authorize before tool execution. Tool input and
model-produced explanations are untrusted. Never give the model unrestricted
database access or treat a model-selected role, organization, permission, or
scope as authority. Protected AI tools use the same centralized authorization
layer as protected routes.

## Public routes and protected-operation contract

Public routes must be explicitly identified in the backend. In the current API,
`GET /health`, `POST /v1/auth/login`, and `POST /v1/auth/logout` are routes that
do not require an authenticated session for their documented functions;
login/logout still enforce their origin and request checks. `GET /v1/auth/session`
requires a valid session. The demo AI route is unauthenticated
only in development/test and returns `not_found` in production. Every other
route must deny access unless it succeeds through the centralized
authorization layer.

Every protected operation must specify its target organization, required
`resource.action` permission, and applicable scope. Before performing it, the
authorization layer verifies the authenticated user, target organization,
active membership, membership roles, an explicit permission grant, and the
scope of every target record. Missing or conflicting context, inactive
membership, insufficient permission, out-of-scope data, cross-organization
references, or unavailable/unverifiable authorization data result in denial.
Checks must happen before protected data is returned or changes are committed.

## Security invariants and examples

- A valid authenticated session establishes identity only, not organization
  access.
- A user suspended in Organization A is denied there; this does not by itself
  suspend the user's active membership in Organization B.
- A user with active membership in Organization A cannot use an Organization B
  ID or record ID to cross into B without a separately verified active
  membership and applicable grants in B.
- A client linked to Student A is denied access to Student B by submitting
  Student B's ID, even if both students are in the same organization. A client
  membership with no trusted student link has no student-record access.
- Staff assigned to Class A are denied class-scoped access to Class B by
  submitting Class B's ID. Assignment must be verified from trusted data.
- If one role grants a narrow record set and another role grants a different
  explicit record set, the resulting set may be their union. The combination
  does not imply access to other records or organization-wide scope.
- An admin's organization-wide access requires an explicit grant and never
  crosses the organization's boundary.
- Membership, role, or permission changes are effective on subsequent
  protected requests; the initial implementation does not rely on a stale
  authorization cache.
- Authorization decisions are deterministic backend decisions, never AI
  decisions. All protected routes and tools use one centralized layer and
  deny by default.

## Unresolved decisions and future implementation

The permission catalog, role-to-permission matrix, canonical scope vocabulary,
and concrete representation of permission-and-scope grants still require
explicit decisions before middleware implementation. The current database has
no permission or scope policy persistence, no client-membership-to-student
link, and no staff-to-class assignment model. The current shared scope type
also does not include the `own_user` or `assigned_class` relationship concepts.

Future implementation work must separately review the schema for those
relationships and policy needs, including the client link cardinality of at
most one student per membership per organization. It must review how current
`pending` and `ended` membership states and the `visitor` role are treated;
this documentation batch makes no database constraint or data migration
change. Implementation must add the centralized authorization layer, fail
closed on missing authoritative data, protect routes and tools, and verify
cross-organization, client-student, staff-class, multi-role, membership-status,
permission, and scope behavior with tests.
