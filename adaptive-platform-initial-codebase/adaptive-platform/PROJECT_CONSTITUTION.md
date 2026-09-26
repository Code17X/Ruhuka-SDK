# Project Constitution

## Non-negotiable principles

1. **AI is never the security authority.** AI may request tools; deterministic backend authorization decides access.
2. **Authorization is server-side.** UI visibility is not authorization.
3. **Tenant isolation is mandatory.** Organization boundaries are enforced in backend/data access.
4. **Least privilege.** Access follows role + permission + data scope.
5. **Browser input is untrusted.** SDK observations and client claims are never trusted for authorization.
6. **Contracts before integration.** Shared types and API/tool contracts are explicit.
7. **Small changes.** Agents make focused changes and run checks.
8. **Human ownership.** Humans approve architecture, security, production deployment, and data policy.
