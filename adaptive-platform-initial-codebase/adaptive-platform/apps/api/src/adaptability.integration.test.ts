import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { hashPassword } from "./auth.js";
import {
  canAccessEntity,
  getAssignedEntityIds,
  getLinkedEntityIds,
  requirePermission,
} from "./authorization.js";
import { createApiServer } from "./server.js";

const org = "cf463143-ab36-4fad-820b-bca37723a1ef";
const otherOrg = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const origin = "http://localhost:3000";
const migration = (name: string) =>
  readFile(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8");

describe("adaptable organization PostgreSQL and HTTP integration", () => {
  let db: PGlite;
  let pool: Pool;
  let server: ReturnType<typeof createApiServer>;
  let baseUrl: string;
  let cookie: string;
  let adminId: string;
  let teacherId: string;
  let teacherMembership: string;
  let parentId: string;
  let parentMembership: string;
  let parentCookie: string;
  let studentEntity: string;
  let classEntity: string;
  let attendanceEntity: string;
  let migrationSql: string;

  const query = async (sql: string, values?: unknown[]) =>
    db.query(sql, values);
  async function request(
    path: string,
    body?: unknown,
    options: { tenant?: string; session?: string; requestOrigin?: string } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: options.requestOrigin ?? origin,
        "Content-Type": "application/json",
        "X-Organization-Id": options.tenant ?? org,
        Cookie: options.session ?? cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }
  async function login(email: string) {
    const response = await fetch(`${baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  async function entity(source: string, id: string) {
    const result = await db.query<{ id: string }>(
      "SELECT id FROM entities WHERE organization_id = $1 AND legacy_source = $2 AND legacy_id = $3",
      [org, source, id],
    );
    return result.rows[0].id;
  }

  before(async () => {
    db = new PGlite();
    // Exact legacy foundation; tests never connect to DATABASE_URL or Supabase.
    await db.exec(
      "CREATE TABLE schema_migrations(version TEXT UNIQUE, name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now());",
    );
    for (const name of [
      "001_database_foundation",
      "002_authentication",
      "004_policy_catalogs",
      "007_classes",
      "008_staff_class_assignments",
      "009_departments",
      "010_staff_department_assignments",
      "011_audit_log",
    ]) {
      await db.exec(await migration(name));
    }
    // Migration 006 has diverged locally to UUID; the original foundation uses TEXT.
    await db.exec(`CREATE TABLE client_student_links(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL, membership_id UUID NOT NULL, student_id TEXT NOT NULL,
      FOREIGN KEY(organization_id, student_id) REFERENCES students(organization_id, student_id));`);
    await db.exec(await migration("012_explicit_enrollments_permissions"));
    await db.query(
      "INSERT INTO organizations(id, name) VALUES ($1, 'Test School'), ($2, 'Other Clinic')",
      [org, otherOrg],
    );
    const hash = await hashPassword("password123");
    for (const [email, role] of [
      ["teacher@test.com", "admin"],
      ["reader@test.com", "teacher"],
      ["parent@test.com", "parent"],
    ]) {
      const user = await db.query<{ id: string }>(
        "INSERT INTO users(email, password_hash, account_status) VALUES ($1, $2, 'active') RETURNING id",
        [email, hash],
      );
      const member = await db.query<{ id: string }>(
        "INSERT INTO memberships(organization_id, user_id) VALUES ($1, $2) RETURNING id",
        [org, user.rows[0].id],
      );
      await db.query(
        "INSERT INTO membership_roles(organization_id, membership_id, role) VALUES ($1, $2, $3)",
        [org, member.rows[0].id, role],
      );
      if (role === "admin") adminId = user.rows[0].id;
      if (role === "teacher") {
        teacherId = user.rows[0].id;
        teacherMembership = member.rows[0].id;
      }
      if (role === "parent") {
        parentId = user.rows[0].id;
        parentMembership = member.rows[0].id;
      }
    }
    const classroom = await db.query<{ id: string }>(
      "INSERT INTO classes(organization_id, name) VALUES ($1, 'Class A') RETURNING id",
      [org],
    );
    await db.query(
      "INSERT INTO students(organization_id, student_id, display_name) VALUES ($1, 'S1', 'Student One'), ($1, 'S2', 'Withdrawn Student')",
      [org],
    );
    await db.query(
      "INSERT INTO students(organization_id, student_id, display_name) VALUES ($1, 'S1', 'Other Tenant Student')",
      [otherOrg],
    );
    await db.query(
      "INSERT INTO staff_class_assignments(organization_id, membership_id, class_id) VALUES ($1, $2, $3)",
      [org, teacherMembership, classroom.rows[0].id],
    );
    await db.query(
      "INSERT INTO client_student_links(organization_id, membership_id, student_id) VALUES ($1, $2, 'S1')",
      [org, parentMembership],
    );
    await db.query(
      "INSERT INTO enrollments(organization_id, student_id, class_id, term, status) VALUES ($1, 'S1', $2, '2026', 'active'), ($1, 'S2', $2, '2026', 'withdrawn')",
      [org, classroom.rows[0].id],
    );
    const attendance = await db.query<{ id: string }>(
      "INSERT INTO attendance(organization_id, student_id, attended_at, status) VALUES ($1, 'S1', now(), 'present') RETURNING id",
      [org],
    );
    migrationSql = await migration("013_adaptable_organizations");
    await db.exec(migrationSql);
    studentEntity = await entity("students", "S1");
    classEntity = await entity("classes", classroom.rows[0].id);
    attendanceEntity = await entity("attendance", attendance.rows[0].id);
    // Pool-compatible adapter to an actual isolated PostgreSQL engine.
    pool = {
      query,
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool;
    server = createApiServer(pool, {
      nodeEnv: "test",
      apiPort: 4000,
      databaseUrl: "",
      corsOrigin: origin,
      aiProvider: "mock",
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cookie = await login("teacher@test.com");
    parentCookie = await login("parent@test.com");
  });

  after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (db) await db.close();
  });

  test("preserves login and /v1/users/me for admin and parent", async () => {
    assert.deepEqual(await request("/v1/users/me"), {
      status: 200,
      body: { userId: adminId, email: "teacher@test.com" },
    });
    assert.equal(
      (await request("/v1/users/me", undefined, { session: parentCookie }))
        .status,
      200,
    );
  });

  test("preserves education data, contexts, and generic scope enforcement", async () => {
    assert.deepEqual(
      await getAssignedEntityIds(pool, teacherMembership, "assigned_to", org),
      [classEntity],
    );
    assert.deepEqual(
      await getLinkedEntityIds(pool, parentMembership, "linked_to", org),
      [studentEntity],
    );
    assert.deepEqual(
      await getAssignedEntityIds(
        pool,
        teacherMembership,
        "assigned_to",
        otherOrg,
      ),
      [],
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: teacherId,
        organizationId: org,
        permission: "student.read",
        entityType: "student",
        entityId: studentEntity,
      }),
      true,
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: teacherId,
        organizationId: org,
        permission: "student.read",
        entityType: "student",
        entityId: await entity("students", "S2"),
      }),
      false,
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: teacherId,
        organizationId: org,
        permission: "attendance.read",
        entityType: "attendance",
        entityId: attendanceEntity,
      }),
      true,
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: parentId,
        organizationId: org,
        permission: "attendance.read",
        entityType: "attendance",
        entityId: attendanceEntity,
      }),
      true,
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: parentId,
        organizationId: org,
        permission: "attendance.read",
        entityType: "attendance",
        entityId: classEntity,
      }),
      false,
    );
    const result = await db.query<{
      context: { term: string };
      active: boolean;
    }>(
      "SELECT context, active FROM relationships WHERE organization_id = $1 AND relationship_type = 'enrolled_in' AND from_entity_id = $2",
      [org, studentEntity],
    );
    assert.equal(result.rows[0].context.term, "2026");
    assert.equal(result.rows[0].active, true);
  });

  test("creates every configuration resource and applies a new organization-specific permission", async () => {
    for (const [path, body] of [
      [
        "entity-types",
        { key: "patient", displayName: "Patient", schema: { type: "object" } },
      ],
      ["entity-types", { key: "appointment", displayName: "Appointment" }],
      [
        "relationship-types",
        {
          key: "appointment_for",
          displayName: "Appointment for",
          fromEntityType: "appointment",
          toEntityType: "patient",
        },
      ],
      ["roles", { key: "doctor", displayName: "Doctor" }],
      [
        "permissions",
        { key: "patient.read", description: "Read permitted patients" },
      ],
      [
        "role-permissions",
        {
          roleKey: "doctor",
          permissionKey: "patient.read",
          scope: "assigned_entity",
        },
      ],
    ] as const) {
      const response = await request(`/v1/org/${path}`, body);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.ok(response.body.id);
      assert.equal(response.body.organization_id, org);
    }
    assert.deepEqual(
      (await request("/v1/org/permissions/check?permission=patient.read")).body,
      { granted: false },
    );
    assert.equal(
      (
        await request("/v1/org/role-permissions", {
          roleKey: "admin",
          permissionKey: "patient.read",
          scope: "organization",
        })
      ).status,
      201,
    );
    assert.deepEqual(
      (await request("/v1/org/permissions/check?permission=patient.read")).body,
      { granted: true, scopes: ["organization"] },
    );
    // Assign a custom role without modifying legacy membership_roles.
    await db.query(
      `INSERT INTO organization_membership_roles(organization_id, membership_id, role_id)
      SELECT $1, $2, id FROM organization_roles WHERE organization_id = $1 AND role_key = 'doctor'`,
      [org, teacherMembership],
    );
    assert.deepEqual(
      await requirePermission(pool, {
        userId: teacherId,
        organizationId: org,
        permission: "patient.read",
      }),
      { granted: true, scopes: ["assigned_entity"] },
    );
    assert.equal((await request("/v1/users/me")).status, 200);
  });

  test("enforces custom healthcare relationships and scopes without education helpers", async () => {
    const patient = await db.query<{ id: string }>(
      "INSERT INTO entities(organization_id, entity_type, data) VALUES ($1, 'patient', '{\"name\":\"Demo\"}') RETURNING id",
      [org],
    );
    const anchor = await db.query<{ entity_id: string }>(
      "SELECT entity_id FROM membership_entities WHERE organization_id = $1 AND membership_id = $2",
      [org, teacherMembership],
    );
    await db.query(
      "INSERT INTO relationships(organization_id, relationship_type, from_entity_id, to_entity_id) VALUES ($1, 'assigned_to', $2, $3)",
      [org, anchor.rows[0].entity_id, patient.rows[0].id],
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: teacherId,
        organizationId: org,
        permission: "patient.read",
        entityType: "patient",
        entityId: patient.rows[0].id,
      }),
      true,
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: teacherId,
        organizationId: org,
        permission: "patient.read",
        entityType: "patient",
        entityId: classEntity,
      }),
      false,
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: teacherId,
        organizationId: otherOrg,
        permission: "patient.read",
        entityType: "patient",
        entityId: patient.rows[0].id,
      }),
      false,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO relationships(organization_id, relationship_type, from_entity_id, to_entity_id) VALUES ($1, 'appointment_for', $2, $3)",
        [org, patient.rows[0].id, patient.rows[0].id],
      ),
    );
  });

  test("provisions a fresh organization and membership anchor without legacy catalog dependence", async () => {
    const fresh = await db.query<{ id: string }>(
      "INSERT INTO organizations(name) VALUES ('New Legal Firm') RETURNING id",
    );
    const tenant = fresh.rows[0].id;
    await db.query("SELECT bootstrap_organization_configuration($1)", [tenant]);
    await db.query("SELECT bootstrap_organization_configuration($1)", [tenant]);
    const member = await db.query<{ id: string }>(
      "INSERT INTO memberships(organization_id, user_id) VALUES ($1, $2) RETURNING id",
      [tenant, adminId],
    );
    await db.query(
      `INSERT INTO organization_membership_roles(organization_id, membership_id, role_id)
      SELECT $1, $2, id FROM organization_roles WHERE organization_id = $1 AND role_key = 'admin'`,
      [tenant, member.rows[0].id],
    );
    const first = await db.query<{ ensure_membership_entity: string }>(
      "SELECT ensure_membership_entity($1, $2)",
      [tenant, member.rows[0].id],
    );
    const second = await db.query<{ ensure_membership_entity: string }>(
      "SELECT ensure_membership_entity($1, $2)",
      [tenant, member.rows[0].id],
    );
    assert.equal(
      first.rows[0].ensure_membership_entity,
      second.rows[0].ensure_membership_entity,
    );
    await assert.rejects(
      db.query("SELECT ensure_membership_entity($1, $2)", [
        org,
        member.rows[0].id,
      ]),
    );
    assert.equal(
      (await request("/v1/users/me", undefined, { tenant })).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/v1/org/entity-types",
          { key: "case", displayName: "Case" },
          { tenant },
        )
      ).status,
      201,
    );
  });

  test("rejects cross-tenant FK references, grants and configuration requests", async () => {
    const foreign = await db.query<{ id: string }>(
      "SELECT id FROM entities WHERE organization_id = $1 LIMIT 1",
      [otherOrg],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO relationships(organization_id, relationship_type, from_entity_id, to_entity_id) VALUES ($1, 'linked_to', $2, $3)",
        [org, studentEntity, foreign.rows[0].id],
      ),
    );
    assert.equal(
      await canAccessEntity(pool, {
        userId: adminId,
        organizationId: org,
        permission: "student.read",
        entityType: "student",
        entityId: foreign.rows[0].id,
      }),
      false,
    );
    assert.equal(
      (
        await request(
          "/v1/org/roles",
          { key: "intruder", displayName: "Intruder" },
          { tenant: otherOrg },
        )
      ).status,
      403,
    );
    assert.deepEqual(
      (
        await request(
          "/v1/org/permissions/check?permission=patient.read",
          undefined,
          { tenant: otherOrg },
        )
      ).body,
      { granted: false },
    );
    await assert.rejects(
      db.query(
        `INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope)
      SELECT $1, r.id, p.id, 'organization' FROM organization_roles r CROSS JOIN organization_permissions p
      WHERE r.organization_id = $2 AND r.role_key = 'admin' AND p.organization_id = $1 AND p.permission_key = 'user.read'`,
        [org, otherOrg],
      ),
    );
  });

  test("requires admin, valid origin and valid configuration bodies", async () => {
    assert.equal(
      (
        await request(
          "/v1/org/roles",
          { key: "nope", displayName: "Nope" },
          { session: parentCookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/v1/org/roles",
          { key: "nope", displayName: "Nope" },
          { requestOrigin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/v1/org/roles", { key: "bad-key", displayName: "Bad" }))
        .status,
      400,
    );
    assert.equal(
      (
        await request("/v1/org/roles", {
          key: "spoof",
          displayName: "Spoof",
          organizationId: otherOrg,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/v1/org/roles", { key: "doctor", displayName: "Doctor" }))
        .status,
      409,
    );
    assert.equal(
      (
        await request("/v1/org/role-permissions", {
          roleKey: "doctor",
          permissionKey: "patient.read",
          scope: "path:out.unknown_relation",
        })
      ).status,
      422,
    );
  });

  test("fails mutations with HTTP 500 on audit errors while GET remains available", async () => {
    await db.exec(`CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'test audit unavailable' USING ERRCODE = '23505'; END $$;
      CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_fail_audit();`);
    const original = console.error;
    console.error = () => {};
    try {
      const failed = await request("/v1/org/roles", {
        key: "must_not_exist",
        displayName: "Must not exist",
      });
      assert.deepEqual(failed, {
        status: 500,
        body: { error: "internal_error" },
      });
      assert.equal(
        (
          await db.query(
            "SELECT id FROM organization_roles WHERE organization_id = $1 AND role_key = 'must_not_exist'",
            [org],
          )
        ).rows.length,
        0,
      );
      assert.equal((await request("/v1/users/me")).status, 200);
    } finally {
      console.error = original;
      await db.exec(
        "DROP TRIGGER test_audit_failure ON audit_log; DROP FUNCTION test_fail_audit();",
      );
    }
    assert.ok(
      (
        await db.query(
          "SELECT id FROM audit_log WHERE organization_id = $1 AND permission = 'org.configure' AND decision = 'granted'",
          [org],
        )
      ).rows.length > 0,
    );
  });

  test("denies suspended membership and prevents legacy snapshot re-import", async () => {
    await db.query(
      "UPDATE memberships SET status = 'suspended' WHERE organization_id = $1 AND id = $2",
      [org, teacherMembership],
    );
    assert.deepEqual(
      await getAssignedEntityIds(pool, teacherMembership, "assigned_to", org),
      [],
    );
    assert.deepEqual(
      await requirePermission(pool, {
        userId: teacherId,
        organizationId: org,
        permission: "patient.read",
      }),
      { granted: false, reason: "membership_inactive" },
    );
    await assert.rejects(db.exec(migrationSql), /already applied/);
    await db.exec("ROLLBACK");
    assert.equal((await request("/v1/users/me")).status, 200);
  });

  test(
    "runs the delivered PowerShell integration script through the HTTP API",
    { skip: process.platform !== "win32" },
    async () => {
      const tenant = (
        await db.query<{ id: string }>(
          "INSERT INTO organizations(name) VALUES ('PowerShell Clinic') RETURNING id",
        )
      ).rows[0].id;
      await db.query("SELECT bootstrap_organization_configuration($1)", [
        tenant,
      ]);
      const member = (
        await db.query<{ id: string }>(
          "INSERT INTO memberships(organization_id, user_id) VALUES ($1, $2) RETURNING id",
          [tenant, adminId],
        )
      ).rows[0].id;
      await db.query(
        `INSERT INTO organization_membership_roles(organization_id, membership_id, role_id)
        SELECT $1, $2, id FROM organization_roles WHERE organization_id = $1 AND role_key = 'admin'`,
        [tenant, member],
      );
      for (const extraArgs of [[], ["-AllowExisting"]]) {
        const result = await promisify(execFile)(
          "pwsh",
          [
            "-NoProfile",
            "-File",
            fileURLToPath(
              new URL(
                "../../../scripts/test-adaptability.ps1",
                import.meta.url,
              ),
            ),
            "-BaseUrl",
            baseUrl,
            "-Origin",
            origin,
            "-OrganizationId",
            tenant,
            "-OtherOrganizationId",
            otherOrg,
            ...extraArgs,
          ],
          {
            env: { ...process.env, ADAPTIVE_TEST_PASSWORD: "password123" },
            timeout: 60000,
          },
        );
        assert.match(result.stdout, /All requested live checks passed/);
        assert.match(result.stdout, /PASS POST \/v1\/auth\/logout/);
        assert.equal(result.stderr, "");
      }
    },
  );
});
