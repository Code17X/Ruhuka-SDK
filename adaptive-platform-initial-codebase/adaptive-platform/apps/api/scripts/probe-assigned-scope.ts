import assert from "node:assert/strict";
import { Pool } from "pg";
import { authenticateSession } from "../src/auth.js";
import { executeAiTool } from "../src/ai-tools.js";
import { requirePermission } from "../src/authorization.js";

const databaseUrl = process.env.DATABASE_URL;
if (
  !databaseUrl ||
  !new URL(databaseUrl).hostname.endsWith(".pooler.supabase.com")
)
  throw new Error("DATABASE_URL must use the Supabase pooler hostname.");
const pool = new Pool({ connectionString: databaseUrl });
try {
  // Use the actual HTTP login session, not a caller-supplied user identity.
  const user = await authenticateSession(
    pool,
    process.env.ADAPTIVE_PROBE_SESSION,
  );
  assert.equal(
    user?.userId,
    "f1500000-0000-4000-8000-000000000001",
    "Unexpected login identity",
  );
  const context = {
    userId: user!.userId,
    organizationId: "cf463143-ab36-4fad-820b-bca37723a1ef",
  };
  const grant = await requirePermission(pool, {
    ...context,
    permission: "student.read",
  });
  assert.deepEqual(grant, { granted: true, scopes: ["assigned_entity"] });
  const assigned = "f1500000-0000-4000-8000-000000000004";
  const unassigned = "f1500000-0000-4000-8000-000000000005";
  const existence = await pool.query(
    "SELECT id FROM entities WHERE organization_id = $1 AND entity_type = $2 AND id = ANY($3::uuid[])",
    [context.organizationId, "student", [assigned, unassigned]],
  );
  assert.equal(
    existence.rows.length,
    2,
    "Both students must exist for a meaningful denial test",
  );
  for (const id of [assigned, unassigned]) {
    const result = await executeAiTool(pool, context, {
      id: "scope-probe",
      type: "function",
      function: {
        name: "get_entity_details",
        arguments: JSON.stringify({ entityId: id }),
      },
    });
    if (id === assigned) {
      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].entityId, assigned);
    } else {
      assert.deepEqual(result.data, { error: "not_found_or_forbidden" });
      assert.deepEqual(result.sources, []);
      assert.deepEqual(result.accesses, []);
    }
  }
  console.log(
    "PASS: direct executor allows assigned ID and returns not_found_or_forbidden for existing unassigned ID.",
  );
} finally {
  await pool.end();
}
