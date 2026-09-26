# Adaptive Platform — Database Specification

**Version:** 0.1.0  
**Initial database:** PostgreSQL recommended.

## 1. Design Principles

- Every tenant-owned entity is associated with an organization.
- Use UUID/ULID-style identifiers rather than predictable sequential public IDs.
- Store timestamps in UTC.
- Use foreign keys and database constraints.
- Prefer normalized relational data for authorization-critical records.
- Add indexes based on actual access patterns.
- Do not store secrets in ordinary tables.
- Do not use AI-generated free-form data as an authorization source.

---

## 2. Core Entities

### organizations

```text
id
name
slug
type
status
settings_json
created_at
updated_at
```

`type` may initially include:

- school
- clinic
- business
- university
- other

This is configuration, not authorization.

### users

```text
id
email
username
phone
password_hash
status
created_at
updated_at
```

Never store plaintext passwords.

### organization_memberships

```text
id
organization_id
user_id
status
created_at
updated_at
```

This explicitly associates a user with a tenant.

### roles

```text
id
organization_id nullable
name
description
system_role
created_at
updated_at
```

Initial system roles:

- visitor
- client
- staff
- admin

The architecture should allow additional scoped roles later.

### permissions

```text
id
key
description
resource
action
```

Examples:

```text
profile.read
attendance.read
attendance.write
student.read
grade.read
report.create
message.send
organization.analytics.read
```

### role_permissions

```text
role_id
permission_id
```

### user_roles

```text
id
organization_id
user_id
role_id
scope_json
created_at
```

`scope_json` can initially represent structured scope while the system matures.

---

## 3. Organization Data

The exact organization-specific schema should evolve by vertical.

For school MVP:

### student_profiles

```text
id
organization_id
user_id
student_number
class_group_id
status
created_at
updated_at
```

### staff_profiles

```text
id
organization_id
user_id
staff_number
department
status
```

### class_groups

```text
id
organization_id
name
academic_year
grade_level
```

### class_memberships

```text
id
organization_id
class_group_id
student_user_id
```

### attendance_records

```text
id
organization_id
student_user_id
class_group_id
date
status
recorded_by
created_at
updated_at
```

### academic_records

```text
id
organization_id
student_user_id
subject
assessment_type
score
max_score
recorded_at
recorded_by
```

### conduct_records

Only include this in the MVP if requirements are approved.

---

## 4. Communication

### conversations

```text
id
organization_id
created_at
updated_at
```

### conversation_members

```text
conversation_id
user_id
```

### messages

```text
id
organization_id
conversation_id
sender_user_id
body
created_at
```

Do not let message visibility depend on AI interpretation alone.

---

## 5. AI

### ai_sessions

```text
id
organization_id
user_id
agent_type
created_at
updated_at
```

### ai_messages

```text
id
session_id
role
content
created_at
```

Consider separating sensitive tool results from model-visible conversation history.

### ai_tool_calls

```text
id
organization_id
user_id
session_id
tool_name
input_json
authorization_result
result_metadata_json
created_at
```

Do not store unnecessary private tool outputs.

---

## 6. Website Intelligence

### websites

```text
id
organization_id nullable
domain
status
configuration_json
created_at
updated_at
```

### website_pages

```text
id
website_id
url
page_type
content_hash
semantic_snapshot_json
created_at
updated_at
```

### website_anchors

```text
id
website_page_id
anchor_type
selector_hint
semantic_description
confidence
geometry_json
status
created_at
updated_at
```

### adaptation_records

```text
id
website_page_id
component_type
anchor_id nullable
strategy_json
result
confidence
created_at
```

---

## 7. Experience Memory

### adaptation_experiences

```text
id
organization_id nullable
website_type
page_type
component_type
context_json
solution_json
evaluation_json
success
created_at
```

Experience memory must be treated as advisory knowledge.

It must never grant permission.

---

## 8. Audit

### audit_logs

```text
id
organization_id
actor_user_id nullable
action
resource_type
resource_id nullable
authorization_result nullable
metadata_json
created_at
```

Audit logs should be append-oriented and access-controlled.

---

## 9. Required Constraints

At minimum:

- unique organization slug;
- unique organization membership per user;
- unique role/permission association;
- foreign keys on tenant relationships;
- appropriate uniqueness for student numbers within an organization;
- indexes on organization IDs;
- indexes on user IDs;
- indexes on common authorization lookups;
- indexes on time-series records such as attendance and academic data.

---

## 10. Migration Rules

Never edit an already-applied production migration destructively.

Create a new migration.

Every schema migration must:

1. be reviewable;
2. be reproducible;
3. have rollback considerations;
4. update `docs/database.md` when semantics change;
5. include relevant tests.
