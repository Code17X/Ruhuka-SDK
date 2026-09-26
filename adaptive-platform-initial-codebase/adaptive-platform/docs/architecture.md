# Architecture

```text
Existing Website
      |
      v
 JavaScript SDK
      |-- Website Intelligence
      |-- Adaptive UI
      v
     API
      |-- Identity
      |-- Permission Engine
      |-- Domain Services
      |-- AI Orchestrator
      |     |-- role agents
      |     |-- tool registry
      |     `-- provider abstraction
      `-- PostgreSQL
```

The initial implementation uses TypeScript across the foundation so browser SDK, API, AI, and shared contracts can evolve together.

Production framework/ORM/database choices are explicit decisions, not hidden assumptions.
