import type { Pool } from "pg";

export type PermissionDecision =
  { granted: true; scopes: string[] } | { granted: false; reason: string };

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
    const row = membership.rows[0] as
      { id: string; status: string } | undefined;
    if (!row) return { granted: false, reason: "membership_not_found" };
    if (row.status !== "active")
      return { granted: false, reason: "membership_inactive" };

    const result = await pool.query(
      `SELECT DISTINCT rp.scope
       FROM organization_role_permissions rp
       JOIN organization_permissions p
         ON p.id = rp.permission_id AND p.organization_id = rp.organization_id
       JOIN organization_roles r ON r.id = rp.role_id AND r.organization_id = rp.organization_id
       WHERE rp.organization_id = $2 AND p.permission_key = $3
         AND (
           EXISTS (SELECT 1 FROM membership_roles mr
                   WHERE mr.membership_id = $1 AND mr.organization_id = $2 AND mr.role = r.role_key)
           OR EXISTS (SELECT 1 FROM organization_membership_roles mr
                      WHERE mr.membership_id = $1 AND mr.organization_id = $2 AND mr.role_id = r.id)
         )
       ORDER BY rp.scope`,
      [row.id, input.organizationId, input.permission],
    );
    const scopes = result.rows.map(
      (grant) => (grant as { scope: string }).scope,
    );
    return scopes.length
      ? { granted: true, scopes }
      : { granted: false, reason: "permission_not_granted" };
  } catch {
    return { granted: false, reason: "authorization_unavailable" };
  }
}

export async function hasOrganizationRole(
  pool: Pick<Pool, "query">,
  input: { userId: string; organizationId: string; roleKey: string },
): Promise<boolean> {
  // Errors propagate: a failed admin lookup is an infrastructure error, not a grant.
  const result = await pool.query(
    `SELECT 1 FROM memberships m
     JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = $3
     WHERE m.user_id = $1 AND m.organization_id = $2 AND m.status = 'active'
       AND (EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.organization_id = m.organization_id
                    AND mr.membership_id = m.id AND mr.role = r.role_key)
         OR EXISTS (SELECT 1 FROM organization_membership_roles mr WHERE mr.organization_id = m.organization_id
                    AND mr.membership_id = m.id AND mr.role_id = r.id))`,
    [input.userId, input.organizationId, input.roleKey],
  );
  return result.rows.length > 0;
}

export function scopePath(scope: string): string[] | null {
  if (scope === "assigned_entity") return ["out.assigned_to"];
  if (scope === "linked_entity") return ["out.linked_to"];
  if (
    !/^path:(out|in)\.[a-z][a-z0-9_]{0,63}(\/(out|in)\.[a-z][a-z0-9_]{0,63}){0,3}$/.test(
      scope,
    )
  )
    return null;
  return scope.slice(5).split("/");
}

export function isSupportedScope(scope: string): boolean {
  return (
    scope === "organization" ||
    scope === "own_user" ||
    scopePath(scope) !== null
  );
}

/** All traversal starts at the trusted membership anchor and stays in its tenant. */
async function entitiesAlongPath(
  pool: Pick<Pool, "query">,
  membershipId: string,
  path: string[],
  organizationId?: string,
): Promise<string[]> {
  try {
    const result = await pool.query(
      `WITH RECURSIVE walk(organization_id, entity_id, depth) AS (
         SELECT m.organization_id, me.entity_id, 0 FROM memberships m
         JOIN membership_entities me ON me.organization_id = m.organization_id AND me.membership_id = m.id
         WHERE m.id = $1 AND m.status = 'active' AND ($3::uuid IS NULL OR m.organization_id = $3)
         UNION
         SELECT w.organization_id,
           CASE WHEN split_part(($2::text[])[w.depth + 1], '.', 1) = 'out'
                THEN r.to_entity_id ELSE r.from_entity_id END, w.depth + 1
         FROM walk w JOIN relationships r ON r.organization_id = w.organization_id
           AND r.relationship_type = split_part(($2::text[])[w.depth + 1], '.', 2)
           AND r.active
           AND ((split_part(($2::text[])[w.depth + 1], '.', 1) = 'out' AND r.from_entity_id = w.entity_id)
             OR (split_part(($2::text[])[w.depth + 1], '.', 1) = 'in' AND r.to_entity_id = w.entity_id))
         WHERE w.depth < cardinality($2::text[])
       ) SELECT DISTINCT entity_id FROM walk WHERE depth = cardinality($2::text[]) ORDER BY entity_id`,
      [membershipId, path, organizationId ?? null],
    );
    return result.rows.map((row) => (row as { entity_id: string }).entity_id);
  } catch {
    return [];
  }
}

export async function getLinkedEntityIds(
  pool: Pick<Pool, "query">,
  membershipId: string,
  relationshipType: string,
  organizationId?: string,
): Promise<string[]> {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(relationshipType)) return [];
  return entitiesAlongPath(
    pool,
    membershipId,
    [`out.${relationshipType}`],
    organizationId,
  );
}

export const getAssignedEntityIds = getLinkedEntityIds;

/** Enumerate an entity type using the same grants and graph paths as canAccessEntity.
 * The permission is derived by the backend, never supplied by the model.
 */
export async function getAccessibleEntityIds(
  pool: Pick<Pool, "query">,
  input: { userId: string; organizationId: string; entityType: string },
): Promise<string[]> {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.entityType)) return [];
  const decision = await requirePermission(pool, {
    ...input,
    permission: `${input.entityType}.read`,
  });
  if (!decision.granted) {
    if (decision.reason === "authorization_unavailable")
      throw new Error("Authorization storage unavailable");
    return [];
  }
  const membership = await pool.query<{ id: string }>(
    "SELECT id FROM memberships WHERE user_id = $1 AND organization_id = $2 AND status = 'active'",
    [input.userId, input.organizationId],
  );
  if (!membership.rows[0]) return [];
  const ids = new Set<string>();
  const organizationScope = decision.scopes.includes("organization");
  if (!organizationScope) {
    for (const scope of decision.scopes) {
      const path = scope === "own_user" ? [] : scopePath(scope);
      if (path) {
        for (const id of await entitiesAlongPath(
          pool,
          membership.rows[0].id,
          path,
          input.organizationId,
        ))
          ids.add(id);
      }
    }
  }
  const entities = await pool.query<{ id: string }>(
    `SELECT id FROM entities WHERE organization_id = $1 AND entity_type = $2
       AND ($3::boolean OR id = ANY($4::uuid[])) ORDER BY id`,
    [input.organizationId, input.entityType, organizationScope, [...ids]],
  );
  return entities.rows.map((entity) => entity.id);
}

/** Permission grants alone never authorize an arbitrary entity ID. */
export async function canAccessEntity(
  pool: Pick<Pool, "query">,
  input: {
    userId: string;
    organizationId: string;
    permission: string;
    entityType: string;
    entityId: string;
  },
): Promise<boolean> {
  const decision = await requirePermission(pool, input);
  if (!decision.granted) return false;
  try {
    const result = await pool.query(
      `SELECT m.id AS membership_id FROM memberships m
       JOIN entities e ON e.organization_id = m.organization_id AND e.id = $3 AND e.entity_type = $4
       WHERE m.user_id = $1 AND m.organization_id = $2 AND m.status = 'active'`,
      [input.userId, input.organizationId, input.entityId, input.entityType],
    );
    const row = result.rows[0] as { membership_id: string } | undefined;
    if (!row) return false;
    if (decision.scopes.includes("organization")) return true;
    for (const scope of decision.scopes) {
      const path = scope === "own_user" ? [] : scopePath(scope);
      if (
        path &&
        (
          await entitiesAlongPath(
            pool,
            row.membership_id,
            path,
            input.organizationId,
          )
        ).includes(input.entityId)
      )
        return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** The future executor supplies a trusted tool registry; request data cannot define it. */
export async function checkToolPermission(
  pool: Pick<Pool, "query">,
  input: { userId: string; organizationId: string; toolName: string },
  toolPolicy: Readonly<Record<string, string>> = {},
): Promise<PermissionDecision> {
  const requiredPermission = Object.hasOwn(toolPolicy, input.toolName)
    ? toolPolicy[input.toolName]
    : undefined;
  if (!requiredPermission) {
    return { granted: false, reason: "tool_not_in_policy" };
  }
  return requirePermission(pool, {
    userId: input.userId,
    organizationId: input.organizationId,
    permission: requiredPermission,
  });
}
/**
 * Write an authorization decision to the audit log.
 * Reads are best-effort. Mutations must await this before performing any writes;
 * an audit failure propagates to the route's 500 error handler.
 */
export async function auditAuthorizationDecision(
  pool: Pick<Pool, "query">,
  input: {
    userId: string;
    organizationId: string;
    permission: string;
    resource?: string;
    scope?: string;
    decision: "granted" | "denied";
    reason?: string;
    route?: string;
  },
  isMutation: boolean,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, organization_id, permission, resource, scope, decision, reason, route)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.userId,
        input.organizationId,
        input.permission,
        input.resource ?? null,
        input.scope ?? null,
        input.decision,
        input.reason ?? null,
        input.route ?? null,
      ],
    );
  } catch (error) {
    if (isMutation) throw error;
    // Read-only requests remain available when audit storage is unavailable.
  }
}
