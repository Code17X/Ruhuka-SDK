# Adaptive Platform — Authorization & Permission Model

**Version:** 0.1.0

## 1. Security Model

Authorization is:

```text
Subject
+ Organization
+ Role
+ Permission
+ Resource
+ Scope
+ Context
→ Decision
```

A role alone is insufficient.

---

## 2. Initial Roles

### Visitor

Can access:

- public content;
- public AI capabilities.

Cannot access private organization records.

### Client

Can access:

- own profile;
- own permitted records;
- permitted organization announcements;
- permitted communication.

Cannot access another client's private records.

### Staff

Can access:

- assigned operational data;
- assigned groups/classes/cases;
- authorized staff tools;
- permitted reports.

Scope depends on organization assignment.

### Admin

Can access organization-wide resources only where the admin permission explicitly permits it.

---

## 3. Permission Naming

Use:

`resource.action`

Examples:

```text
profile.read
profile.update
attendance.read
attendance.write
grade.read
grade.write
student.read
student.update
report.read
report.create
message.read
message.send
organization.analytics.read
user.manage
role.manage
```

Avoid vague permissions such as:

```text
is_admin
can_do_everything
```

---

## 4. Scope

Examples:

```text
self
assigned
group
department
organization
```

Example:

```text
teacher
attendance.read
scope=assigned
```

A principal may have:

```text
attendance.read
scope=organization
```

A student may have:

```text
attendance.read
scope=self
```

---

## 5. Authorization Pipeline

```text
Request
 ↓
Authenticate
 ↓
Resolve user
 ↓
Resolve organization membership
 ↓
Resolve roles
 ↓
Resolve permission
 ↓
Resolve resource
 ↓
Evaluate scope
 ↓
Allow / Deny
```

---

## 6. AI Authorization

AI follows:

```text
User
 ↓
AI
 ↓
Tool request
 ↓
Tool schema validation
 ↓
Permission engine
 ↓
Data/action
```

Never:

```text
User
 ↓
AI
 ↓
Database
```

---

## 7. Object-Level Authorization

Example:

Student A asks:

```text
getAttendance(studentId=B)
```

The backend must evaluate:

```text
actor = Student A
requested resource = Student B attendance
permission = attendance.read
scope = self
```

Result:

```text
DENY
```

It must not depend on the model deciding that this seems inappropriate.

---

## 8. Organization Isolation

Every protected query must establish tenant context.

A user from organization A must not retrieve organization B's records by changing:

```text
organizationId
studentId
recordId
```

in a request.

---

## 9. Server Enforcement

Client-side UI should hide unavailable features for usability.

But the server must enforce the same rules independently.

Therefore:

```text
UI visibility ≠ security
```

---

## 10. Permission Changes

Changing a role or permission is a security-sensitive operation.

It requires:

- authentication;
- authorization;
- audit logging;
- validation;
- appropriate admin scope.

---

## 11. Security Tests

Every protected feature should have tests for:

1. authorized self-access;
2. unauthorized peer access;
3. unauthorized role access;
4. cross-tenant access;
5. manipulated IDs;
6. direct API calls bypassing UI;
7. AI tool calls attempting unauthorized access.
