# TASK-007 — AI Provider Abstraction

**Owner:** Member 3  
**Status:** READY after repository foundation

## Goal

Create a provider-independent interface for model calls.

## Requirements

Support conceptually:

- text generation;
- structured output;
- tool calling;
- vision input where supported.

## Acceptance Criteria

- [ ] application code depends on an internal interface;
- [ ] provider-specific code is isolated;
- [ ] model configuration is externalized;
- [ ] errors normalized;
- [ ] tests can run with mocked models.
