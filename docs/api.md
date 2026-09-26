# Adaptive Platform — API Contract

**Version:** 0.1.0  
**Status:** Initial contract; implementation may refine details through ADRs.

## 1. Rules

- API contracts are shared boundaries.
- Consumers must not guess response shapes.
- Breaking changes require a versioning/migration decision.
- Protected endpoints require authentication and authorization.
- Errors use predictable structures.
- IDs are opaque identifiers.

---

## 2. Base Structure

Recommended:

```text
/api/v1/
```

Initial domains:

```text
/auth
/organizations
/users
/roles
/permissions
/students
/attendance
/academics
/messages
/ai
/websites
/adaptations
```

---

## 3. Authentication

Example:

```text
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
```

Exact token/session implementation is an architecture decision.

---

## 4. Current User

```text
GET /api/v1/auth/me
```

Example response:

```json
{
  "user": {
    "id": "user_opaque_id",
    "email": "user@example.test"
  },
  "organization": {
    "id": "org_opaque_id",
    "name": "Example School"
  },
  "roles": [
    {
      "name": "client",
      "scope": "self"
    }
  ]
}
```

---

## 5. Attendance

```text
GET /api/v1/attendance/me
```

The server determines which records belong to the authenticated user.

Do not require the client to send another user's ID for this endpoint.

Staff/admin scoped endpoints may use explicit IDs but must enforce authorization.

---

## 6. AI

```text
POST /api/v1/ai/sessions
POST /api/v1/ai/sessions/{sessionId}/messages
GET  /api/v1/ai/sessions/{sessionId}
```

The server attaches:

- authenticated identity;
- organization;
- role;
- permission context.

The client should not be able to arbitrarily declare:

```json
{
  "role": "admin"
}
```

---

## 7. AI Tool Contract

Internal tool definition example:

```json
{
  "name": "attendance.get_my_attendance",
  "description": "Returns attendance records for the authenticated client.",
  "input_schema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "required_permission": "attendance.read",
  "scope": "self"
}
```

The tool server still verifies permission.

---

## 8. Website Registration

```text
POST /api/v1/websites
GET  /api/v1/websites/{websiteId}
POST /api/v1/websites/{websiteId}/scans
```

The SDK should receive a short-lived authenticated/configured mechanism rather than privileged backend credentials.

---

## 9. Adaptation

```text
POST /api/v1/websites/{websiteId}/adaptations/evaluate
GET  /api/v1/websites/{websiteId}/adaptations
```

Adaptation responses should be treated as instructions/configuration, not arbitrary executable privileged server code.

---

## 10. Error Format

Recommended:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You are not authorized to access this resource.",
    "requestId": "request_opaque_id"
  }
}
```

Do not expose internal stack traces or security-sensitive details.

---

## 11. Contract Testing

Every shared API should have:

- request validation tests;
- response schema tests;
- authorization tests;
- integration tests.

When possible, generate typed client definitions from the canonical API schema.
