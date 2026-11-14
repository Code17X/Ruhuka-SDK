import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pool as PoolType } from "pg";
import {
  auditAuthorizationDecision,
  checkToolPermission,
  getAssignedEntityIds,
  getLinkedEntityIds,
  requirePermission,
} from "./authorization.js";

function fakePool(responses: unknown[][]) {
  let index = 0;
  const pool = {
    query: async () => ({ rows: responses[index++] ?? [] }),
  } as unknown as PoolType;
  return pool;
}

describe("authorization core", () => {
  test("allows a grant and returns its scopes", async () => {
    const pool = fakePool([
      [{ id: "m1", status: "active" }],
      [{ scope: "organization" }],
    ]);
    assert.deepEqual(
      await requirePermission(pool, {
        userId: "u1",
        organizationId: "o1",
        permission: "student.read",
      }),
      { granted: true, scopes: ["organization"] },
    );
  });

  test("denies when there is no membership", async () => {
    assert.deepEqual(
      await requirePermission(fakePool([[]]), {
        userId: "u1",
        organizationId: "o1",
        permission: "student.read",
      }),
      { granted: false, reason: "membership_not_found" },
    );
  });

  test("denies non-active and suspended memberships", async () => {
    for (const status of ["pending", "ended", "suspended"]) {
      assert.deepEqual(
        await requirePermission(fakePool([[{ id: "m1", status }]]), {
          userId: "u1",
          organizationId: "o1",
          permission: "student.read",
        }),
        { granted: false, reason: "membership_inactive" },
      );
    }
  });

  test("denies unknown permissions and unions scopes from multiple roles", async () => {
    const input = {
      userId: "u1",
      organizationId: "o1",
      permission: "not.catalogued",
    };
    assert.deepEqual(
      await requirePermission(
        fakePool([[{ id: "m1", status: "active" }], []]),
        input,
      ),
      { granted: false, reason: "permission_not_granted" },
    );
    assert.deepEqual(
      await requirePermission(
        fakePool([
          [{ id: "m1", status: "active" }],
          [{ scope: "linked_entity" }, { scope: "own_user" }],
        ]),
        { ...input, permission: "student.read" },
      ),
      {
        granted: true,
        scopes: ["linked_entity", "own_user"],
      },
    );
  });

  test("denies closed on database errors without exposing details", async () => {
    const pool = {
      query: async () => {
        throw new Error("secret database detail");
      },
    } as unknown as PoolType;
    assert.deepEqual(
      await requirePermission(pool, {
        userId: "u1",
        organizationId: "o1",
        permission: "student.read",
      }),
      { granted: false, reason: "authorization_unavailable" },
    );
  });

  test("returns no entities for a membership with no links", async () => {
    assert.deepEqual(
      await getLinkedEntityIds(fakePool([[]]), "m1", "linked_to"),
      [],
    );
  });

  test("returns assigned entity IDs and empty array when unassigned", async () => {
    assert.deepEqual(
      await getAssignedEntityIds(
        fakePool([[{ entity_id: "c1" }, { entity_id: "c2" }]]),
        "m1",
        "assigned_to",
      ),
      ["c1", "c2"],
    );
    assert.deepEqual(
      await getAssignedEntityIds(fakePool([[]]), "m1", "assigned_to"),
      [],
    );
  });
});

describe("AI tool authorization", () => {
  test("allows a tool when the underlying permission is granted", async () => {
    const pool = fakePool([
      [{ id: "m1", status: "active" }],
      [{ scope: "organization" }],
    ]);
    assert.deepEqual(
      await checkToolPermission(
        pool,
        {
          userId: "u1",
          organizationId: "o1",
          toolName: "student.read",
        },
        { "student.read": "student.read" },
      ),
      { granted: true, scopes: ["organization"] },
    );
  });

  test("denies a tool when the underlying permission is not granted", async () => {
    const pool = fakePool([[{ id: "m1", status: "active" }], []]);
    assert.deepEqual(
      await checkToolPermission(
        pool,
        {
          userId: "u1",
          organizationId: "o1",
          toolName: "student.read",
        },
        { "student.read": "student.read" },
      ),
      { granted: false, reason: "permission_not_granted" },
    );
  });

  test("denies a tool not in the policy registry", async () => {
    const pool = fakePool([[{ id: "m1", status: "active" }]]);
    assert.deepEqual(
      await checkToolPermission(pool, {
        userId: "u1",
        organizationId: "o1",
        toolName: "unknown.tool",
      }),
      { granted: false, reason: "tool_not_in_policy" },
    );
  });
});

describe("audit authorization decisions", () => {
  test("blocks mutations when auditing fails, for grants and denials", async () => {
    const failure = new Error("audit unavailable");
    const pool = {
      query: async () => {
        throw failure;
      },
    } as unknown as PoolType;
    for (const decision of ["granted", "denied"] as const) {
      let mutated = false;
      await assert.rejects(
        async () => {
          await auditAuthorizationDecision(
            pool,
            {
              userId: "u1",
              organizationId: "o1",
              permission: "student.update",
              decision,
            },
            true,
          );
          mutated = true;
        },
        (error) => error === failure,
      );
      assert.equal(mutated, false);
    }
  });

  test("writes a grant decision to the audit log", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    } as unknown as PoolType;
    await auditAuthorizationDecision(
      pool,
      {
        userId: "u1",
        organizationId: "o1",
        permission: "user.read",
        resource: "user_profile",
        scope: "own_user",
        decision: "granted",
        route: "/v1/users/me",
      },
      false,
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0], /INSERT INTO audit_log/);
  });

  test("writes a denial decision with reason", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    } as unknown as PoolType;
    await auditAuthorizationDecision(
      pool,
      {
        userId: "u1",
        organizationId: "o1",
        permission: "user.read",
        decision: "denied",
        reason: "membership_inactive",
        route: "/v1/users/me",
      },
      false,
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0], /INSERT INTO audit_log/);
  });

  test("does not throw on database errors", async () => {
    const pool = {
      query: async () => {
        throw new Error("database connection failed");
      },
    } as unknown as PoolType;
    await assert.doesNotReject(async () => {
      await auditAuthorizationDecision(
        pool,
        {
          userId: "u1",
          organizationId: "o1",
          permission: "user.read",
          decision: "denied",
          reason: "membership_not_found",
        },
        false,
      );
    });
  });
});
