# ADR-001 — Initial Technology Stack

**Status:** PROPOSED  
**Date:** 2026-09-26

## Context

The project needs a practical stack that three developers can operate while keeping the architecture portable.

## Decision

This ADR is intentionally left PROPOSED until the team reviews and records the exact choices for:

- frontend framework;
- backend framework/runtime;
- database;
- authentication/session library;
- hosting;
- queue/worker mechanism;
- browser testing framework;
- package manager.

## Constraint

Do not select infrastructure merely because an AI agent defaults to it.

The selected stack must support:

- TypeScript where appropriate;
- relational transactions;
- server-side authorization;
- browser SDK distribution;
- automated testing;
- clear local development;
- low-cost/free-tier development;
- future provider portability.

## Approval Required

All three members should review the final stack.

A human should approve the final decision before implementation becomes infrastructure-dependent.
