# TASK-010 — Client AI Vertical Slice

**Owner:** Member 3  
**Status:** BLOCKED until TASK-008 and TASK-009

## Goal

Implement the first end-to-end AI request.

Example:

User asks:
"Show me my attendance."

Flow:

User → AI → attendance tool → permission engine → database → AI → response.

## Acceptance Criteria

- [ ] authenticated client context is attached;
- [ ] only authorized tools are exposed;
- [ ] attendance tool works;
- [ ] unauthorized student IDs cannot be substituted;
- [ ] response is understandable;
- [ ] tool call is auditable.
