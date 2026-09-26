# ADR-002 — AI Model Provider Strategy

**Status:** PROPOSED  
**Date:** 2026-09-26

## Context

The platform needs multiple AI capabilities without being locked to one model vendor.

## Decision

Use an internal model-provider abstraction.

The platform should support:

- fast general models;
- stronger reasoning models;
- structured-output/tool-calling models;
- vision-capable models.

Initial development may use free/low-cost provider tiers where available.

Model selection is configuration, not business logic.

## Consequences

Positive:

- easier provider replacement;
- easier cost control;
- easier evaluation;
- different models can serve different workloads.

Negative:

- provider adapters must be maintained;
- model behavior differs across providers.

## Security

API keys remain server-side.

Client SDK code must never contain model-provider secrets.

## Approval Required

Team review before production provider commitments.
