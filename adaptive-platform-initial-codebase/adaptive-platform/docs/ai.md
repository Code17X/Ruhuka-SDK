# AI Architecture

The AI layer contains a provider abstraction, orchestrator, tool registry, role-specific behavior, context building, and evaluation hooks.

Safe execution flow:

`User -> AI -> Tool request -> Server permission check -> Tool execution`

Never give the model unrestricted database access.

The API's unauthenticated `/v1/ai/sessions/demo/messages` endpoint is a
development/test demo route and returns `not_found` in production. It is not a
production AI capability or an authorization mechanism.
