# Adaptive Platform — System Architecture

**Version:** 0.1.0

## 1. Architectural Overview

```text
                         EXISTING WEBSITE
                                │
                                ▼
                         JAVASCRIPT SDK
                                │
                 ┌──────────────┼──────────────┐
                 ▼              ▼              ▼
             Scanner        Theme/UX       Runtime
                 │              │              │
                 └──────────────┼──────────────┘
                                ▼
                     WEBSITE INTELLIGENCE
                                │
                                ▼
                    SEMANTIC REPRESENTATION
                                │
                         ┌──────┴──────┐
                         ▼             ▼
                    Adaptation       Backend
                       Engine           API
                         │               │
                         │        ┌──────┼────────┐
                         │        ▼      ▼        ▼
                         │     Auth   Policy     Data
                         │             │
                         │             ▼
                         │       Permission Engine
                         │             │
                         └──────┬──────┘
                                ▼
                         AI ORCHESTRATOR
                                │
                 ┌──────────────┼──────────────┐
                 ▼              ▼              ▼
             Visitor AI      Client AI      Staff/Admin AI
                 │              │              │
                 └──────────────┼──────────────┘
                                ▼
                           Tool Registry
                                │
                                ▼
                       Authorized Tool Calls
                                │
                                ▼
                           Data / Actions
```

---

## 2. Major Components

### 2.1 SDK

Runs in the host website.

Responsibilities:

- initialization;
- website inspection;
- metadata extraction;
- DOM/semantic analysis;
- rendering;
- adaptation;
- telemetry;
- runtime health checks.

The SDK is not trusted for authorization.

### 2.2 Website Intelligence Service

Transforms website observations into a normalized semantic representation.

Possible entities:

- Website;
- Page;
- Section;
- Navigation;
- Content region;
- Interactive element;
- Form;
- Theme;
- Layout;
- Semantic anchor.

### 2.3 Adaptation Engine

Determines:

- which component to render;
- where it should appear;
- which visual style to use;
- how it should behave responsively;
- whether a previous placement can be reused;
- whether self-healing is needed.

### 2.4 Identity Service

Handles:

- authentication;
- sessions/tokens;
- organization membership;
- identity resolution.

### 2.5 Permission Engine

Evaluates:

`subject + organization + permission + resource + scope + context`

and returns an allow/deny decision.

### 2.6 Data Layer

Stores organization-owned platform data.

The initial implementation should use a relational database.

### 2.7 AI Orchestrator

Coordinates model calls, context, agent selection, tools, and memory.

It must never bypass the Permission Engine.

### 2.8 Tool Registry

Every AI action is represented as a typed tool with:

- name;
- input schema;
- output schema;
- required permission;
- scope rules;
- audit requirements.

### 2.9 Experience Memory

Stores successful and failed adaptation experiences and other approved reusable patterns.

Memory is not authorization.

### 2.10 Evaluation Layer

Validates:

- functional correctness;
- visual placement;
- responsive behavior;
- accessibility;
- security;
- tool authorization.

---

## 3. Runtime Request Flow

A protected AI request should follow:

```text
User
 ↓
SDK / Portal
 ↓
Authenticated API
 ↓
Identity Resolution
 ↓
Permission Context
 ↓
AI Orchestrator
 ↓
Agent reasoning
 ↓
Tool request
 ↓
Tool authorization
 ↓
Permission Engine
 ↓
Data/action layer
 ↓
Tool result
 ↓
AI response
 ↓
Portal
```

---

## 4. Control Plane vs Data Plane

### Control plane

Contains:

- organization configuration;
- roles;
- permissions;
- website configuration;
- model configuration;
- tool definitions;
- adaptation policies;
- feature flags.

### Data plane

Contains:

- user records;
- organization records;
- attendance;
- grades;
- messages;
- operational data;
- AI sessions;
- website observations.

Keep the distinction clear even if both initially share one database.

---

## 5. Multi-Tenancy

Every organization has a unique ID.

Protected records must carry organization ownership or a verified relationship to an organization.

Application services must establish organization context before protected queries.

Never trust an organization ID supplied by an untrusted client without validating membership.

---

## 6. Event-Driven Extensions

The system may later use events such as:

```text
user.created
user.role.changed
website.scanned
page.changed
adaptation.created
adaptation.failed
ai.tool.requested
ai.tool.denied
message.created
```

Events should be versioned where they cross service boundaries.

---

## 7. Observability

Every important workflow should expose:

- request ID;
- organization ID where appropriate;
- actor/user ID where appropriate;
- service;
- operation;
- duration;
- success/failure;
- error category.

Avoid logging secrets and unnecessary private payloads.

---

## 8. Failure Isolation

An AI failure must not make authentication fail.

A website-analysis failure must not make the existing website unusable.

An adaptation failure should degrade to no injected component rather than break host-page functionality.

A tool authorization failure should return a controlled denial.

---

## 9. MVP Architecture

The MVP may deploy several logical services as one application for simplicity.

Recommended initial logical modules:

```text
API
Auth
Organizations
Permissions
Data
AI
Website Intelligence
Adaptation
SDK
Workers
```

Do not prematurely split everything into microservices.

Use modular boundaries first; extract services only when justified.
