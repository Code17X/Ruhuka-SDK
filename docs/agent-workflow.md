# Adaptive Platform — AI Engineering Workflow

**Version:** 0.1.0

## 1. Goal

Allow three human developers and multiple AI coding/review agents to work in one repository without conflicting changes or losing architectural coherence.

---

## 2. Team Ownership

### Member 1 — Platform Engineer

Owns:

```text
services/api/
database/
auth
organizations
permissions
shared backend contracts
```

### Member 2 — SDK / Adaptive UI Engineer

Owns:

```text
packages/sdk/
services/website-intelligence/
services/adaptation/
packages/ui/
```

### Member 3 — AI / Data Engineer

Owns:

```text
services/ai/
AI tools
memory
evaluation
analytics
model routing
```

Shared changes require review by the affected owners.

---

## 3. AI Roles

### Architect Agent

Maintains architectural coherence.

### Coding Agents

Implement scoped tasks.

### Integration Agent

Checks cross-module compatibility.

### Security Agent

Attempts to break authorization and isolation.

### QA Agent

Runs end-to-end/browser scenarios.

### Debugger Agent

Investigates failing tests and regressions.

---

## 4. Agent Rules

Every coding agent must:

1. Read `PROJECT_CONSTITUTION.md`.
2. Read the relevant architecture documents.
3. Inspect existing code before modifying it.
4. Work on a dedicated branch/worktree.
5. Make focused changes.
6. Run relevant tests.
7. Update documentation.
8. Report changed contracts.
9. Never silently change architecture.
10. Open a PR instead of merging directly.

---

## 5. Task Format

Every task should contain:

```text
ID
Title
Owner
Description
Dependencies
Files/modules allowed
Acceptance criteria
Tests required
Security considerations
Documentation required
```

---

## 6. Dependency Graph

Tasks must be blocked when required dependencies are incomplete.

Example:

```text
Database
 ↓
Authentication
 ↓
Permission Engine
 ↓
Protected API
 ↓
AI Tool
 ↓
AI Agent
 ↓
Portal
```

---

## 7. Branch Naming

Recommended:

```text
feature/TASK-001-org-schema
feature/TASK-002-auth
feature/TASK-003-permissions
feature/TASK-004-sdk-loader
fix/TASK-017-anchor-recovery
chore/TASK-020-ci
```

---

## 8. Commit Rules

Use focused commits.

Examples:

```text
feat(auth): add session creation
feat(permission): add scoped attendance policy
feat(sdk): add initial page scanner
test(permission): add cross-tenant denial cases
fix(sdk): recover missing navigation anchor
docs(ai): document attendance tool
```

Avoid:

```text
update stuff
changes
final
AI fixed it
```

---

## 9. Pull Request Requirements

Every PR should state:

### Summary

What changed?

### Why

Why was it needed?

### Contracts

Did API/schema/tool/SDK contracts change?

### Tests

What was run?

### Security

What security implications exist?

### Risk

What could break?

### Rollback

How can the change be reverted?

---

## 10. Protected Files

The following require extra review:

```text
PROJECT_CONSTITUTION.md
docs/architecture.md
docs/permissions.md
database migrations
auth
permission engine
SDK public API
AI tool authorization
CI configuration
deployment configuration
```

---

## 11. Merge Sequence

```text
Agent branch
 ↓
Local tests
 ↓
PR
 ↓
CI
 ↓
Owner review
 ↓
Integration review
 ↓
Security review where relevant
 ↓
Merge
```

---

## 12. Conflict Resolution

When two agents need the same file:

1. Stop parallel editing of that file.
2. Identify the intended contract.
3. Let the owner of the module lead the merge.
4. Rebase/merge carefully.
5. Run the full affected test suite.
6. Do not resolve conflicts by blindly choosing one side.

---

## 13. Architecture Changes

If an agent discovers a better architecture:

Do NOT silently implement it.

Create:

```text
docs/decisions/ADR-XXX-title.md
```

Include:

- problem;
- current state;
- proposed state;
- alternatives;
- consequences;
- migration plan.

Human approval is required for major architectural changes.

---

## 14. Shared Work Memory

Agents should communicate through repository artifacts:

- task files;
- PRs;
- ADRs;
- contracts;
- test results;
- changelogs.

Do not depend on an AI remembering another AI's conversation.

---

## 15. Definition of Ready

A task is READY when:

- requirements are understandable;
- dependencies are complete;
- owner is assigned;
- relevant contracts exist;
- acceptance criteria exist.

---

## 16. Definition of Done

A task is DONE when:

- implementation is complete;
- tests pass;
- documentation is updated;
- contracts are synchronized;
- security implications are addressed;
- CI passes;
- required reviewers approve.
