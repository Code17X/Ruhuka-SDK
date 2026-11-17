import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { handleAiChat, type AiChatDependencies } from "./ai-chat.js";
import { executeAiTool } from "./ai-tools.js";
import { createSession } from "./auth.js";
import { chatWithTools, type ToolCall } from "./llm-client.js";
import { createApiServer } from "./server.js";

const org = randomUUID();
const otherOrg = randomUUID();
const teacher = randomUUID();
const parent = randomUUID();
const outsider = randomUUID();
const student1 = randomUUID();
const student2 = randomUUID();
const foreignStudent = randomUUID();
const attendance1 = randomUUID();
const attendance2 = randomUUID();
const origin = "http://localhost:3000";
const call = (name: string, args: object, id = randomUUID()): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

describe("AI scoped PostgreSQL and HTTP integration (offline)", () => {
  let db: PGlite;
  let pool: Pool;
  let server: ReturnType<typeof createApiServer>;
  let baseUrl: string;
  let cookie: string;
  let savedKey: string | undefined;
  const query = (sql: string, values?: unknown[]) => db.query(sql, values);
  const chat = (
    userId = teacher,
    body: Record<string, unknown> = { message: "How are my students doing?" },
    deps: AiChatDependencies = {},
  ) =>
    handleAiChat(
      pool,
      { userId, organizationId: org, body },
      { llmContext: { apiKey: "" }, ...deps },
    );
  const tool = (userId: string, name: string, args: object) =>
    executeAiTool(pool, { userId, organizationId: org }, call(name, args));

  before(async () => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    db = new PGlite();
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now());",
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
      // Legacy files 007-011 expect the manually extended ledger.
      if (name === "007_classes")
        await db.exec(
          "ALTER TABLE schema_migrations ADD COLUMN version TEXT UNIQUE;",
        );
      await db.exec(
        await readFile(
          new URL(`../migrations/${name}.sql`, import.meta.url),
          "utf8",
        ),
      );
    }
    await db.exec(`CREATE TABLE client_student_links(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL, membership_id UUID NOT NULL, student_id TEXT NOT NULL,
      FOREIGN KEY(organization_id, student_id) REFERENCES students(organization_id, student_id));`);
    for (const name of [
      "012_explicit_enrollments_permissions",
      "013_adaptable_organizations",
      "014_ai_assistant",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../migrations/${name}.sql`, import.meta.url),
          "utf8",
        ),
      );
    }
    pool = {
      query,
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool;
    await query(
      "INSERT INTO organizations(id, name) VALUES ($1, 'School A'), ($2, 'School B')",
      [org, otherOrg],
    );
    for (const tenant of [org, otherOrg]) {
      await query("SELECT bootstrap_organization_configuration($1)", [tenant]);
      await query(
        `INSERT INTO entity_types(organization_id, type_key, display_name) VALUES ($1, 'student', 'Student'), ($1, 'attendance', 'Attendance')`,
        [tenant],
      );
      await query(
        `INSERT INTO relationship_types(organization_id, type_key, display_name) VALUES ($1, 'attendance_for', 'Attendance for'), ($1, 'peer_of', 'Peer of')`,
        [tenant],
      );
      await query(
        `INSERT INTO organization_roles(organization_id, role_key, display_name) VALUES ($1, 'teacher', 'Teacher'), ($1, 'parent', 'Parent')`,
        [tenant],
      );
      await query(
        `INSERT INTO organization_permissions(organization_id, permission_key) VALUES ($1, 'student.read'), ($1, 'attendance.read')`,
        [tenant],
      );
      await query(
        `INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope)
        SELECT $1, r.id, p.id, CASE WHEN p.permission_key = 'user.read' THEN 'own_user'
          WHEN p.permission_key = 'student.read' AND r.role_key = 'teacher' THEN 'assigned_entity'
          WHEN p.permission_key = 'student.read' THEN 'linked_entity'
          WHEN r.role_key = 'teacher' THEN 'path:out.assigned_to/in.attendance_for'
          ELSE 'path:out.linked_to/in.attendance_for' END
        FROM organization_roles r JOIN organization_permissions p ON p.organization_id = r.organization_id
        WHERE r.organization_id = $1 AND r.role_key IN ('teacher', 'parent')
          AND p.permission_key IN ('user.read', 'student.read', 'attendance.read')`,
        [tenant],
      );
    }
    for (const [user, tenant, role] of [
      [teacher, org, "teacher"],
      [parent, org, "parent"],
      [outsider, otherOrg, "parent"],
    ]) {
      await query("INSERT INTO users(id, email) VALUES ($1, $2)", [
        user,
        `${role}-${tenant}@test.invalid`,
      ]);
      const member = (
        await query(
          "INSERT INTO memberships(organization_id, user_id) VALUES ($1, $2) RETURNING id",
          [tenant, user],
        )
      ).rows[0] as { id: string };
      await query(
        `INSERT INTO organization_membership_roles(organization_id, membership_id, role_id)
        SELECT $1, $2, id FROM organization_roles WHERE organization_id = $1 AND role_key = $3`,
        [tenant, member.id, role],
      );
      await query("SELECT ensure_membership_entity($1, $2)", [
        tenant,
        member.id,
      ]);
    }
    for (const [id, tenant, type, data] of [
      [student1, org, "student", { name: "Alex Chen" }],
      [student2, org, "student", { name: "Sam Lee" }],
      [foreignStudent, otherOrg, "student", { name: "Other Tenant Secret" }],
      [attendance1, org, "attendance", { status: "present" }],
      [attendance2, org, "attendance", { status: "absent" }],
    ] as const)
      await query(
        "INSERT INTO entities(id, organization_id, entity_type, data) VALUES ($1, $2, $3, $4)",
        [id, tenant, type, JSON.stringify(data)],
      );
    for (const [user, tenant, student, relation] of [
      [teacher, org, student1, "assigned_to"],
      [teacher, org, student2, "assigned_to"],
      [parent, org, student1, "linked_to"],
      [outsider, otherOrg, foreignStudent, "linked_to"],
    ])
      await query(
        `INSERT INTO relationships(organization_id, relationship_type, from_entity_id, to_entity_id)
      SELECT $2, $4, me.entity_id, $3 FROM membership_entities me JOIN memberships m ON m.id = me.membership_id AND m.organization_id = me.organization_id
      WHERE m.user_id = $1 AND m.organization_id = $2`,
        [user, tenant, student, relation],
      );
    for (const [from, to, relation] of [
      [attendance1, student1, "attendance_for"],
      [attendance2, student2, "attendance_for"],
      [student1, student2, "peer_of"],
    ])
      await query(
        "INSERT INTO relationships(organization_id, relationship_type, from_entity_id, to_entity_id) VALUES ($1, $2, $3, $4)",
        [org, relation, from, to],
      );
    const session = await createSession(pool, teacher);
    cookie = `ruhuka_session=${session.token}`;
    server = createApiServer(pool, {
      nodeEnv: "test",
      apiPort: 0,
      corsOrigin: origin,
      databaseUrl: "",
      aiProvider: "mock",
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await db?.close();
  });

  test("mock tool loop retrieves teacher records and persists exact sources, messages and audit", async () => {
    const result = await chat();
    assert.equal(result.status, 200);
    const body = result.body as {
      conversationId: string;
      reply: string;
      sourcesUsed: { entityId: string }[];
    };
    assert.match(body.reply, /Alex Chen/);
    assert.match(body.reply, /Sam Lee/);
    assert.doesNotMatch(body.reply, /Other Tenant Secret/);
    assert.deepEqual(
      new Set(body.sourcesUsed.map((source) => source.entityId)),
      new Set([student1, student2, attendance1, attendance2]),
    );
    const audit = (
      await query(
        "SELECT entities_accessed, tool_calls FROM ai_audit_log WHERE conversation_id = $1",
        [body.conversationId],
      )
    ).rows[0] as {
      entities_accessed: { entityId: string }[];
      tool_calls: unknown[];
    };
    assert.ok(
      audit.entities_accessed.some((entry) => entry.entityId === student1),
    );
    assert.ok(audit.tool_calls.length <= 10);
    assert.ok(
      (
        await query("SELECT 1 FROM ai_messages WHERE conversation_id = $1", [
          body.conversationId,
        ])
      ).rows.length <= 50,
    );
  });

  test("parent sees only linked student and attendance; relationships require both endpoints", async () => {
    const result = await chat(parent);
    assert.equal(result.status, 200);
    assert.match(JSON.stringify(result.body), /Alex Chen/);
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /Sam Lee|Other Tenant Secret/,
    );
    assert.deepEqual(
      (await tool(parent, "get_entity_details", { entityId: student2 })).data,
      { error: "not_found_or_forbidden" },
    );
    const relationships = await tool(parent, "get_entity_relationships", {
      entityId: student1,
    });
    assert.match(JSON.stringify(relationships.data), /attendance_for/);
    assert.doesNotMatch(
      JSON.stringify(relationships.data),
      /peer_of|assigned_to|linked_to/,
    );
    assert.ok(
      relationships.accesses.every((entry) =>
        new Set<string>([student1, attendance1]).has(entry.entityId),
      ),
    );
    const context = (await tool(parent, "get_current_user_context", {}))
      .data as { accessibleEntityCounts: Record<string, number> };
    assert.deepEqual(context.accessibleEntityCounts, {
      attendance: 1,
      membership: 0,
      student: 1,
    });
  });

  test("cross-tenant and cross-user conversation IDs are inaccessible", async () => {
    assert.equal((await chat(outsider)).status, 403);
    assert.deepEqual(
      (await tool(teacher, "get_entity_details", { entityId: foreignStudent }))
        .data,
      { error: "not_found_or_forbidden" },
    );
    const first = await chat();
    const conversationId = (first.body as { conversationId: string })
      .conversationId;
    assert.equal(
      (await chat(parent, { message: "Show previous results", conversationId }))
        .status,
      404,
    );
    assert.equal(
      (
        await handleAiChat(
          pool,
          {
            userId: outsider,
            organizationId: otherOrg,
            body: { message: "Show records", conversationId },
          },
          { llmContext: { apiKey: "" } },
        )
      ).status,
      404,
    );
  });

  test("unknown tools, forged tenant arguments, invalid UUIDs and excessive limits are rejected", async () => {
    for (const [name, args] of [
      ["execute_sql", { sql: "select * from users" }],
      [
        "list_accessible_entities",
        { entityType: "student", organizationId: otherOrg },
      ],
      ["list_accessible_entities", { entityType: "student", limit: 1000 }],
      ["get_entity_details", { entityId: "invalid" }],
    ] as const)
      assert.deepEqual((await tool(teacher, name, args)).data, {
        error: "invalid_tool_arguments",
      });
  });

  test("explicit ai.chat denial is not bypassed by user.read fallback", async () => {
    await query(
      "INSERT INTO organization_permissions(organization_id, permission_key) VALUES ($1, 'ai.chat')",
      [org],
    );
    try {
      assert.equal((await chat()).status, 403);
    } finally {
      await query(
        "DELETE FROM organization_permissions WHERE organization_id = $1 AND permission_key = 'ai.chat'",
        [org],
      );
    }
  });

  test("audit insert/update failures roll back conversation and messages", async () => {
    const before = (await query("SELECT id FROM ai_conversations")).rows.length;
    for (const operation of ["INSERT", "UPDATE"]) {
      await db.exec(`CREATE FUNCTION reject_ai_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$;
        CREATE TRIGGER reject_ai_audit BEFORE ${operation} ON ai_audit_log FOR EACH ROW EXECUTE FUNCTION reject_ai_audit();`);
      try {
        await assert.rejects(chat(), /audit failure/);
      } finally {
        await db.exec(
          "DROP TRIGGER reject_ai_audit ON ai_audit_log; DROP FUNCTION reject_ai_audit();",
        );
      }
      assert.equal(
        (await query("SELECT id FROM ai_conversations")).rows.length,
        before,
      );
    }
  });

  test("limits provider requests to ten tools and stores at most fifty total messages", async () => {
    let invoked = 0;
    const result = await chat(
      teacher,
      { message: "Keep looking" },
      {
        chat: async (_messages, _tools, context) => {
          invoked++;
          return context.remainingToolCalls > 0
            ? { reply: null, toolCalls: [call("get_current_user_context", {})] }
            : { reply: "Tool budget exhausted.", toolCalls: [] };
        },
      },
    );
    assert.equal(result.status, 200);
    assert.equal(invoked, 11);
    const id = (result.body as { conversationId: string }).conversationId;
    const count = (
      await query("SELECT 1 FROM ai_messages WHERE conversation_id = $1", [id])
    ).rows.length;
    assert.equal(count, 22);
    await query(
      `INSERT INTO ai_messages(conversation_id, role, content)
      SELECT $1, 'user', '{"role":"user","content":"old"}'::jsonb FROM generate_series(1, $2::integer)`,
      [id, 49 - count],
    );
    assert.equal(
      (await chat(teacher, { message: "one more", conversationId: id })).status,
      429,
    );
    const excessive = await chat(
      teacher,
      { message: "excess" },
      {
        chat: async () => ({
          reply: null,
          toolCalls: Array.from({ length: 11 }, () =>
            call("get_current_user_context", {}),
          ),
        }),
      },
    );
    assert.equal(excessive.status, 429);
  });

  test("threading does not replay stale tool results after scope revocation", async () => {
    const first = await chat(parent);
    const conversationId = (first.body as { conversationId: string })
      .conversationId;
    await query(
      "UPDATE relationships SET active = false WHERE organization_id = $1 AND relationship_type = 'linked_to'",
      [org],
    );
    try {
      const result = await chat(
        parent,
        { message: "What about now?", conversationId },
        {
          chat: async (messages, tools, context) => {
            assert.doesNotMatch(JSON.stringify(messages), /Alex Chen/);
            return chatWithTools(messages, tools, { ...context, apiKey: "" });
          },
        },
      );
      assert.equal(result.status, 200);
      assert.doesNotMatch(JSON.stringify(result.body), /Alex Chen/);
    } finally {
      await query(
        "UPDATE relationships SET active = true WHERE organization_id = $1 AND relationship_type = 'linked_to'",
        [org],
      );
    }
  });

  test("delivered non-admin SQL fixture is repeatable and blocks direct-ID probing", async () => {
    const sql = (
      await readFile(
        new URL(
          "../../../docs/sql/ai-assigned-scope-fixture.sql",
          import.meta.url,
        ),
        "utf8",
      )
    ).replaceAll("cf463143-ab36-4fad-820b-bca37723a1ef", org);
    await db.exec(sql);
    await db.exec(sql);
    const response = await fetch(`${baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "teacher2@test.com",
        password: "password123",
      }),
    });
    assert.equal(
      response.status,
      200,
      "Fixture hash must verify through real login",
    );
    const fixtureCookie = response.headers.get("set-cookie")!.split(";")[0];
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: fixtureCookie,
      "X-Organization-Id": org,
    };
    const grant = await fetch(
      `${baseUrl}/v1/org/permissions/check?permission=student.read`,
      { headers },
    );
    assert.deepEqual(await grant.json(), {
      granted: true,
      scopes: ["assigned_entity"],
    });
    const chatResponse = await fetch(`${baseUrl}/v1/ai/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "Show my assigned students." }),
    });
    assert.equal(chatResponse.status, 200);
    const result = (await chatResponse.json()) as {
      sourcesUsed: { entityId: string }[];
      reply: string;
    };
    assert.deepEqual(
      result.sourcesUsed.map((source) => source.entityId),
      ["f1500000-0000-4000-8000-000000000004"],
    );
    assert.match(result.reply, /Scope Assigned Student/);
    assert.doesNotMatch(result.reply, /Scope Unassigned Student/);
    const user = "f1500000-0000-4000-8000-000000000001";
    const allowed = await tool(user, "get_entity_details", {
      entityId: "f1500000-0000-4000-8000-000000000004",
    });
    assert.equal(allowed.sources.length, 1);
    const denied = await tool(user, "get_entity_details", {
      entityId: "f1500000-0000-4000-8000-000000000005",
    });
    assert.deepEqual(denied.data, { error: "not_found_or_forbidden" });
    assert.deepEqual(denied.sources, []);
    assert.equal(
      (
        await query("SELECT 1 FROM membership_roles WHERE membership_id = $1", [
          "f1500000-0000-4000-8000-000000000002",
        ])
      ).rows.length,
      0,
    );
  });

  test("HTTP route validates session, organization, origin, content type and body", async () => {
    const request = (
      headers: Record<string, string>,
      body: unknown = { message: "How are my students?" },
    ) =>
      fetch(`${baseUrl}/v1/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-Organization-Id": org,
    };
    assert.equal((await request({ ...headers, Cookie: "" })).status, 401);
    assert.equal(
      (await request({ ...headers, "X-Organization-Id": "invalid" })).status,
      400,
    );
    assert.equal((await request({ ...headers, Origin: "" })).status, 403);
    assert.equal(
      (await request({ ...headers, "Content-Type": "text/plain" })).status,
      415,
    );
    assert.equal((await request(headers, { message: "   " })).status, 400);
    const result = await request(headers);
    assert.equal(result.status, 200);
    assert.match(JSON.stringify(await result.json()), /Alex Chen/);
  });
});

test("OpenAI adapter uses gpt-4o-mini tool protocol and never silently falls back on errors", async () => {
  const response = await chatWithTools(
    [{ role: "user", content: "hello" }],
    [],
    {
      apiKey: "test-only",
      entityTypes: [],
      remainingToolCalls: 10,
      fetch: async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        const body = JSON.parse(init!.body as string);
        assert.equal(body.model, "gpt-4o-mini");
        assert.equal(body.store, false);
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [call("get_current_user_context", {})],
                },
              },
            ],
          }),
        );
      },
    },
  );
  assert.equal(response.toolCalls[0].function.name, "get_current_user_context");
  await assert.rejects(
    chatWithTools([], [], {
      apiKey: "test-only",
      entityTypes: [],
      remainingToolCalls: 0,
      fetch: async () =>
        new Response("private upstream error", { status: 500 }),
    }),
    /^Error: AI provider request failed$/,
  );
});
