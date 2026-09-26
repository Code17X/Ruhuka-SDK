# Adaptive Platform — Project Constitution

**Status:** Foundational / Draft for Team Approval  
**Version:** 0.1.0  
**Purpose:** Governing engineering rules for the Adaptive Platform.

---

## 1. Mission

The Adaptive Platform is a multi-tenant, AI-powered application layer that can be embedded into existing websites through a JavaScript SDK.

It combines:

- website intelligence,
- adaptive UI,
- identity and authentication,
- role/scoped authorization,
- organization data,
- role-aware AI agents,
- tool calling,
- communication,
- analytics,
- experience memory,
- automated evaluation,
- self-healing UI.

The platform must be able to begin with a school use case while keeping its core architecture general enough to support other organizations such as universities, clinics, businesses, and similar institutions.

### Core principle

> The AI is the reasoning layer. The platform's deterministic security and business logic remain the authority.

---

## 2. Product Boundaries

### The platform IS

- a multi-tenant SaaS/application platform;
- an embeddable JavaScript SDK;
- a website intelligence and adaptation system;
- a role/scoped-permission system;
- an AI orchestration and tool platform;
- an organization data and workflow layer.

### The platform is NOT

- merely a web scraper;
- merely a chatbot;
- an AI model trained from scratch;
- a browser extension;
- an authorization system controlled by an LLM;
- a collection of unrelated AI-generated pages.

---

## 3. Foundational Invariants

These rules are non-negotiable unless the team explicitly approves an architecture decision.

### 3.1 Security authority

LLMs MUST NOT be the final authority for:

- authentication;
- authorization;
- tenant isolation;
- access to private records;
- role assignment;
- privileged actions.

The server-side permission engine is authoritative.

### 3.2 Tenant isolation

Every organization is a tenant.

A request must be associated with an authenticated identity and organization context where applicable.

Data access must prevent cross-tenant leakage.

### 3.3 Least privilege

Permissions must be granted only where necessary.

The initial model is:

`Identity + Role + Permission + Data Scope`

not merely:

`User + Role`.

### 3.4 AI tool boundary

AI agents may request tools.

Tools must independently validate authorization before performing protected operations.

### 3.5 Browser trust boundary

The browser and SDK are untrusted environments.

Never rely on client-side checks for security.

### 3.6 Contracts before integration

Services communicate through explicit contracts.

Do not invent undocumented API shapes inside another member's work.

### 3.7 Main branch stability

`main` must remain buildable and testable.

Direct pushes to `main` are prohibited for normal development.

### 3.8 Reproducibility

A clean checkout should be capable of being installed, tested, built, and run using documented commands.

---

## 4. Product Roles

The initial predefined roles are:

### Visitor

Public, unauthenticated or minimally identified user.

Typical access:

- public website information;
- restricted public AI assistant;
- public organization information.

### Client

The organization's primary service recipient.

Examples:

- student;
- patient;
- customer;
- member.

Typical access:

- own profile;
- own records;
- permitted organization information;
- permitted communication.

### Staff

Organization worker.

Examples:

- teacher;
- nurse;
- employee.

Typical access:

- authorized operational records;
- assigned groups/classes/cases;
- staff tools;
- reporting within scope.

### Admin

Organization administrator.

Typical access:

- organization-wide authorized data;
- user/role administration;
- broad analytics;
- communication;
- administrative tools.

**Important:** Role names are not themselves sufficient for authorization. Permissions and data scopes determine actual access.

---

## 5. Initial Vertical Slice

The first end-to-end milestone is intentionally narrow:

```text
Existing Website
    ↓
SDK loads
    ↓
SDK performs basic website scan
    ↓
Backend receives website metadata
    ↓
User authenticates
    ↓
Server resolves organization + role
    ↓
Permission engine authorizes request
    ↓
Client portal appears
    ↓
Client AI is initialized
    ↓
AI requests one authorized tool
    ↓
Permission engine validates tool request
    ↓
Authorized data returned
    ↓
Response displayed
```

For the first school demonstration:

> Student logs in and asks the AI to show their own attendance.

Do not expand the first milestone until this path works reliably.

---

## 6. Architecture Principles

1. **Modular monorepo.**
2. **Clear service/package ownership.**
3. **Shared contracts.**
4. **Deterministic security.**
5. **AI through tools.**
6. **Local deterministic extraction before expensive AI reasoning.**
7. **Memory/retrieval before model retraining.**
8. **Evaluation before storing a solution as successful.**
9. **Observability from the beginning.**
10. **Human approval for architecture/security changes.**

---

## 7. AI Engineering Rules

### AI should reason about

- page type;
- website semantics;
- component purpose;
- placement;
- user intent;
- tool selection;
- report generation;
- summarization;
- analytics interpretation;
- adaptation strategies.

### AI should NOT directly decide

- whether a user is authenticated;
- whether a user has permission;
- whether one tenant may access another tenant;
- whether a privileged action is allowed;
- whether a database row should be exposed merely because the prompt requests it.

### Model abstraction

All model calls must pass through a provider abstraction.

The application must not be tightly coupled to one provider.

---

## 8. Website Intelligence Rules

The SDK should prefer deterministic collection of:

- DOM structure;
- headings;
- links;
- buttons;
- forms;
- ARIA attributes;
- metadata;
- Schema.org / JSON-LD;
- URLs;
- computed styles;
- colors;
- typography;
- element geometry;
- viewport information;
- responsive behavior.

AI should receive a compact semantic representation whenever possible instead of raw, unnecessarily large DOM dumps.

---

## 9. Adaptive UI Rules

Injected UI should use semantic anchors and stable identifiers rather than depending exclusively on fragile CSS selectors.

Every adaptation should record:

- target page;
- component;
- anchor strategy;
- confidence;
- visual validation result;
- responsive validation result;
- outcome.

If an anchor disappears:

```text
detect failure
→ re-analyze
→ find semantic alternatives
→ validate
→ reposition
→ record result
```

Self-healing must not silently bypass security or authorization.

---

## 10. Data and Privacy Rules

The platform must minimize collected data.

Sensitive organizational data must not be sent to external model providers unless the architecture explicitly permits it and the data flow has been reviewed.

Logs must avoid unnecessary secrets and private payloads.

Never store:

- passwords;
- raw authentication secrets;
- API keys;
- session tokens

in source control.

---

## 11. Change Management

Any change affecting:

- database architecture;
- permission semantics;
- tenant isolation;
- authentication;
- AI security boundary;
- SDK public API;
- event contracts;
- major infrastructure choices

requires an Architecture Decision Record in `docs/decisions/`.

---

## 12. Definition of Done

A task is complete only when:

- implementation exists;
- relevant tests exist;
- type checking passes;
- linting passes;
- documentation is updated where required;
- contracts are updated where required;
- security implications have been considered;
- no unrelated files were changed unnecessarily;
- PR description explains the change;
- CI passes.

---

## 13. Human Authority

AI agents are engineering assistants, not project owners.

Humans retain final authority over:

- architecture;
- security;
- deployment;
- data policy;
- production releases;
- major product decisions.

---

## 14. Current Non-Goals

The initial build will NOT attempt to fully solve:

- arbitrary website compatibility;
- autonomous production deployment without approval;
- automatic model training;
- unrestricted autonomous database modification;
- unrestricted code execution from AI-generated content;
- perfect visual understanding;
- every organization type simultaneously.

The architecture should allow these later, but the MVP should remain controlled.

---

## 15. Success Criterion

The foundation succeeds when three developers and their AI agents can work in parallel without needing to guess:

- where code belongs;
- which component owns a responsibility;
- what an API returns;
- who may access data;
- how AI tools are authorized;
- how changes are integrated;
- how failures are tested.
