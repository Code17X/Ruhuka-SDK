import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runMigrations } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const suite = describe(
  "PostgreSQL tenant schema",
  { skip: !databaseUrl },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    let organizationA: string;
    let organizationB: string;
    let userId: string;
    let membershipId: string;

    before(async () => {
      await runMigrations(pool);
      const organizations = await pool.query(
        "INSERT INTO organizations (name) VALUES ('School A'), ('School B') RETURNING id",
      );
      [organizationA, organizationB] = organizations.rows.map(
        (row: { id: string }) => row.id,
      );
      const user = await pool.query(
        "INSERT INTO users (email) VALUES ($1) RETURNING id",
        [`db-test-${organizationA}@example.invalid`],
      );
      userId = user.rows[0].id as string;
      const membership = await pool.query(
        "INSERT INTO memberships (organization_id, user_id) VALUES ($1, $2) RETURNING id",
        [organizationA, userId],
      );
      membershipId = membership.rows[0].id as string;
    });

    after(async () => {
      if (organizationA && organizationB) {
        await pool.query(
          "DELETE FROM attendance WHERE organization_id = ANY($1::uuid[])",
          [[organizationA, organizationB]],
        );
        await pool.query(
          "DELETE FROM organizations WHERE id = ANY($1::uuid[])",
          [[organizationA, organizationB]],
        );
      }
      await pool.end();
    });

    test("allows two organizations to use the same student_id", async () => {
      await pool.query(
        "INSERT INTO students (organization_id, student_id, display_name) VALUES ($1, 'S-1', 'Student A'), ($2, 'S-1', 'Student B')",
        [organizationA, organizationB],
      );
    });

    test("accepts attendance for a student in the same organization", async () => {
      await pool.query(
        "INSERT INTO attendance (organization_id, student_id, attended_at, status) VALUES ($1, 'S-1', now(), 'present')",
        [organizationA],
      );
    });

    test("rejects attendance with a different organization's student", async () => {
      await pool.query(
        "INSERT INTO students (organization_id, student_id, display_name) VALUES ($1, 'A-ONLY', 'School A only')",
        [organizationA],
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO attendance (organization_id, student_id, attended_at, status) VALUES ($1, 'A-ONLY', now(), 'present')",
          [organizationB],
        ),
        (error) => (error as { code?: string }).code === "23503",
      );
    });

    test("rejects membership for a nonexistent organization", async () => {
      await assert.rejects(
        pool.query(
          "INSERT INTO memberships (organization_id, user_id) VALUES ('00000000-0000-0000-0000-000000000001', $1)",
          [userId],
        ),
        (error) => (error as { code?: string }).code === "23503",
      );
    });

    test("rejects membership for a nonexistent user", async () => {
      await assert.rejects(
        pool.query(
          "INSERT INTO memberships (organization_id, user_id) VALUES ($1, '00000000-0000-0000-0000-000000000002')",
          [organizationB],
        ),
        (error) => (error as { code?: string }).code === "23503",
      );
    });

    test("rejects a duplicate user and organization membership", async () => {
      await assert.rejects(
        pool.query(
          "INSERT INTO memberships (organization_id, user_id) VALUES ($1, $2)",
          [organizationA, userId],
        ),
        (error) => (error as { code?: string }).code === "23505",
      );
    });

    test("rejects duplicate roles for a membership", async () => {
      await pool.query(
        "INSERT INTO membership_roles (organization_id, membership_id, role) VALUES ($1, $2, 'staff')",
        [organizationA, membershipId],
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO membership_roles (organization_id, membership_id, role) VALUES ($1, $2, 'staff')",
          [organizationA, membershipId],
        ),
        (error) => (error as { code?: string }).code === "23505",
      );
    });
  },
);

void suite;
