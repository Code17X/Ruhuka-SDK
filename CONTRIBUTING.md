# Contributing to Adaptive Platform

## 1. Before Starting

Read:

1. `PROJECT_CONSTITUTION.md`
2. `docs/architecture.md`
3. the relevant module documentation
4. your assigned task

Do not begin from assumptions.

---

## 2. Ownership

| Area | Primary owner |
|---|---|
| Backend / DB / Auth / Permissions | Member 1 |
| SDK / Website Intelligence / Adaptation / UI | Member 2 |
| AI / Tools / Memory / Evaluation / Analytics | Member 3 |

Ownership means responsibility, not exclusive access.

---

## 3. Branches

Never develop normal work directly on `main`.

Use:

```text
feature/TASK-ID-description
fix/TASK-ID-description
chore/TASK-ID-description
```

---

## 4. Small Changes

Prefer several understandable PRs over one huge PR.

A PR should solve one coherent problem.

---

## 5. Tests

At minimum, run the tests relevant to the modified area.

Before merging a major feature:

```text
lint
typecheck
unit tests
integration tests
security tests
build
```

---

## 6. API Changes

If an API changes:

1. update the canonical contract;
2. update consumers;
3. add/update tests;
4. document migration impact.

---

## 7. Database Changes

Never manually modify shared environments without a migration.

Every schema change requires a migration file.

---

## 8. Secrets

Never commit:

```text
.env
API keys
passwords
tokens
private certificates
service-account secrets
```

Use `.env.example` for variable names.

---

## 9. Generated Code

Generated code must be reproducible.

Do not commit generated artifacts unless the repository explicitly requires them.

---

## 10. AI-Generated Code

AI-generated code is treated exactly like human-written code.

The developer who submits it is responsible for:

- understanding it;
- testing it;
- reviewing security;
- ensuring architectural compatibility.

---

## 11. Review Standard

Review for:

- correctness;
- maintainability;
- security;
- performance;
- test coverage;
- contract compatibility;
- unnecessary complexity.

Do not approve merely because tests are green.

---

## 12. Documentation

If behavior changes, documentation changes with it.

Documentation is part of the implementation.
