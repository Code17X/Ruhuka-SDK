import test from "node:test";
import assert from "node:assert/strict";
import type { PermissionDecision } from "./index.js";

test("permission decision has explicit authorization state", () => {
  const decision: PermissionDecision = { allowed: false, reason: "not implemented" };
  assert.equal(decision.allowed, false);
});
