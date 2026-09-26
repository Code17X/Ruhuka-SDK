# Adaptive Platform

Initial GitHub-ready monorepo foundation for an AI-powered adaptive application platform.

## First vertical slice

```text
Existing Website -> SDK -> API -> Identity -> Permission
-> Client Portal -> AI Orchestrator -> Authorized Tool -> Result
```

## Layout

```text
apps/
  api/                  Backend API foundation
  web/                  Portal foundation
packages/
  shared/               Shared TypeScript contracts
  config/               Environment/config foundation
  sdk/                  Embeddable browser SDK
  ai/                   AI provider/orchestration foundation
docs/                    Architecture and decisions
agent-work/              Agent roles and tasks
.github/workflows/       CI
```

## Setup

Requirements: Node.js 20+, pnpm 10+.

```bash
pnpm install
cp .env.example .env
pnpm check
pnpm dev
```

API: http://localhost:4000/health
Web: http://localhost:3000

## Important

This is deliberately a foundation, not a production-ready platform. Authentication, production database tooling, authorization persistence, real AI providers, and advanced adaptive behavior are next tasks.

Read `PROJECT_CONSTITUTION.md` before coding.
