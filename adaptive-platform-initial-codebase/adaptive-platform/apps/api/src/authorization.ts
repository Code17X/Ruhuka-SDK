import type { Pool } from "pg";

export type PermissionDecision =
  | { granted: true; scopes: string[] }
  | { granted: false; reason: string };

export async function requirePermission(
  pool: Pick<Pool, "query">,
  input: { userId: string; organizationId: string; permission: string },
): Promise<PermissionDecision> {
  try {
    const membership = await pool.query(
      `SELECT id, status FROM memberships
       WHERE user_id = $1 AND organization_id = $2`,
      [input.userId, input.organizationId],
    );
    const row = membership.rows[0] as { id: string; status: string } | undefined;
    if (!row) return { granted: false, reason: "membership_not_found" };
    if (row.status !== "active") return { granted: false, reason: "membership_inactive" };

    const result = await pool.query(
      `SELECT DISTINCT rp.scope
       FROM membership_roles mr
       JOIN roles r ON r.key = mr.role
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE mr.membership_id = $1 AND mr.organization_id = $2 AND p.key = $3
       ORDER BY rp.scope`,
      [row.id, input.organizationId, input.permission],
    );
    const scopes = result.rows.map((grant) => (grant as { scope: string }).scope);
    return scopes.length ? { granted: true, scopes } : { granted: false, reason: "permission_not_granted" };
  } catch {
    return { granted: false, reason: "authorization_unavailable" };
  }
}

export async function getLinkedStudentId(
  pool: Pick<Pool, "query">,
  membershipId: string,
): Promise<string | null> {
  try {
    const result = await pool.query(
      "SELECT student_id FROM client_student_links WHERE membership_id = $1",
      [membershipId],
    );
    return (result.rows[0] as { student_id: string } | undefined)?.student_id ?? null;
  } catch {
    return null;
  }
}

export async function getAssignedClassIds(
  pool: Pick<Pool, "query">,
  membershipId: string,
): Promise<string[]> {
  try {
    const result = await pool.query(
      "SELECT class_id FROM staff_class_assignments WHERE membership_id = $1 ORDER BY class_id",
      [membershipId],
    );
    return result.rows.map((row) => (row as { class_id: string }).class_id);
  } catch {
    return [];
  }
}
