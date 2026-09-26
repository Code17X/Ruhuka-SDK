# AI Architecture

The AI layer contains a provider abstraction, orchestrator, tool registry, role-specific behavior, context building, and evaluation hooks.

Safe execution flow:

`User -> AI -> Tool request -> Server permission check -> Tool execution`

Never give the model unrestricted database access.
