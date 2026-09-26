# API Contract

Initial endpoints:

- `GET /health`
- `POST /v1/websites/scan`
- `GET /v1/me`
- `POST /v1/ai/sessions`
- `POST /v1/ai/sessions/:sessionId/messages`

Protected endpoints will be wired after authentication and authorization are implemented.

Shared contracts live in `packages/shared`.
