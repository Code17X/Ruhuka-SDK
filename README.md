# Adaptive Platform

AI-powered adaptive application infrastructure for existing websites.

## Vision

Transform existing websites into role-aware, permission-controlled applications through an embeddable JavaScript SDK.

The platform combines:

- Website Intelligence
- Adaptive UI
- Identity
- RBAC + scoped permissions
- Organization data
- AI agents
- Tool calling
- Communication
- Analytics
- Experience memory
- Evaluation
- Self-healing

---

## Initial Use Case

School portal.

Initial roles:

- Visitor
- Client/Student
- Staff/Teacher
- Admin

---

## First Vertical Slice

```text
Website
 ↓
SDK
 ↓
Basic scan
 ↓
Backend
 ↓
Authentication
 ↓
Permission Engine
 ↓
Student Portal
 ↓
Client AI
 ↓
Attendance Tool
 ↓
Authorized Attendance Result
```

---

## Repository

```text
apps/
packages/
services/
database/
tests/
docs/
agent-work/
```

See `PROJECT_CONSTITUTION.md`.

---

## Development Principles

- AI is not the security authority.
- Server-side authorization is mandatory.
- Tenant isolation is mandatory.
- Contracts are explicit.
- Main remains stable.
- Agents work on branches.
- Tests gate merges.
- Major architecture changes require ADRs.

---

## Team

### Member 1

Platform / Backend

### Member 2

SDK / Adaptive UI

### Member 3

AI / Data

---

## Getting Started

The exact framework/runtime is to be locked in the initial architecture decision.

Once approved, this README should contain:

```text
Prerequisites
Installation
Environment variables
Database setup
Development commands
Testing
Build
Deployment
```

Do not invent commands before the stack is selected.

---

## Current Status

Phase 0 — Architecture and repository foundation.
