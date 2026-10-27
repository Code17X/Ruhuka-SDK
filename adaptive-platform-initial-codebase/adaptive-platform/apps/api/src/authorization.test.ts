import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pool as PoolType } from "pg";
import { getLinkedStudentId, requirePermission } from "./authorization.js";

function fakePool(responses: unknown[][]) {
  let index = 0;
  const pool = {
    query: async () => ({ rows: responses[index++] ?? [] }),
  } as unknown as PoolType;
  return pool;
}

describe("authorization core", () => {
  test("allows a grant and returns its scopes", async () => {
    const pool = fakePool([[{ id: "m1", status: "active" }], [{ scope: "organization" }]]);
    assert.deepEqual(await requirePermission(pool, {
      userId: "u1", organizationId: "o1", permission: "student.read",
    }), { granted: true, scopes: ["organization"] });
  });

  test("denies when there is no membership", async () => {
    assert.deepEqual(await requirePermission(fakePool([[]]), {
      userId: "u1", organizationId: "o1", permission: "student.read",
    }), { granted: false, reason: "membership_not_found" });
  });

  test("denies non-active and suspended memberships", async () => {
    for (const status of ["pending", "ended", "suspended"]) {
      assert.deepEqual(await requirePermission(fakePool([[{ id: "m1", status }]]), {
        userId: "u1", organizationId: "o1", permission: "student.read",
      }), { granted: false, reason: "membership_inactive" });
    }
  });

  test("denies unknown permissions and unions scopes from multiple roles", async () => {
    const input = { userId: "u1", organizationId: "o1", permission: "not.catalogued" };
    assert.deepEqual(await requirePermission(fakePool([[{ id: "m1", status: "active" }], []]), input),
      { granted: false, reason: "permission_not_granted" });
    assert.deepEqual(await requirePermission(fakePool([
      [{ id: "m1", status: "active" }],
      [{ scope: "linked_student" }, { scope: "own_user" }],
    ]), { ...input, permission: "student.read" }), {
      granted: true, scopes: ["linked_student", "own_user"],
    });
  });

  test("denies closed on database errors without exposing details", async () => {
    const pool = { query: async () => { throw new Error("secret database detail"); } } as unknown as PoolType;
    assert.deepEqual(await requirePermission(pool, {
      userId: "u1", organizationId: "o1", permission: "student.read",
    }), { granted: false, reason: "authorization_unavailable" });
  });

  test("returns null for a client membership with no linked student", async () => {
    assert.equal(await getLinkedStudentId(fakePool([[]]), "m1"), null);
  });
});
