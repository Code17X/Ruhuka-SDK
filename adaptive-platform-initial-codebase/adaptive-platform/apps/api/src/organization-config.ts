import type { Pool, PoolClient } from "pg";
import {
  auditAuthorizationDecision,
  hasOrganizationRole,
  isSupportedScope,
  requirePermission,
  scopePath,
} from "./authorization.js";

export const configurationRoutes = new Set([
  "/v1/org/entity-types",
  "/v1/org/relationship-types",
  "/v1/org/roles",
  "/v1/org/permissions",
  "/v1/org/role-permissions",
]);
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isKey = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
export const isPermissionKey = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_.]{0,127}$/.test(value);
const isName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 120;
const isObject = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class ConfigurationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function validateBody(route: string, body: Record<string, unknown>) {
  const allowed: Record<string, string[]> = {
    "/v1/org/entity-types": ["key", "displayName", "schema"],
    "/v1/org/relationship-types": [
      "key",
      "displayName",
      "fromEntityType",
      "toEntityType",
    ],
    "/v1/org/roles": ["key", "displayName"],
    "/v1/org/permissions": ["key", "description"],
    "/v1/org/role-permissions": ["roleKey", "permissionKey", "scope"],
  };
  if (
    !allowed[route] ||
    Object.keys(body).some((key) => !allowed[route].includes(key))
  )
    throw new ConfigurationError(400, "invalid_request");
  if (route.endsWith("/role-permissions")) {
    if (
      !isKey(body.roleKey) ||
      !isPermissionKey(body.permissionKey) ||
      typeof body.scope !== "string" ||
      !isSupportedScope(body.scope)
    )
      throw new ConfigurationError(400, "invalid_request");
    if (body.permissionKey === "user.read" && body.scope !== "own_user")
      throw new ConfigurationError(400, "invalid_scope");
    if (body.permissionKey === "org.configure" && body.scope !== "organization")
      throw new ConfigurationError(400, "invalid_scope");
  } else if (route.endsWith("/permissions")) {
    if (
      !isPermissionKey(body.key) ||
      (body.description !== undefined &&
        (typeof body.description !== "string" ||
          body.description.length > 2000))
    )
      throw new ConfigurationError(400, "invalid_request");
  } else {
    if (!isKey(body.key) || !isName(body.displayName))
      throw new ConfigurationError(400, "invalid_request");
    if (body.schema !== undefined && !isObject(body.schema))
      throw new ConfigurationError(400, "invalid_request");
    for (const key of ["fromEntityType", "toEntityType"]) {
      if (body[key] !== undefined && !isKey(body[key]))
        throw new ConfigurationError(400, "invalid_request");
    }
  }
}

async function insertConfiguration(
  client: PoolClient,
  route: string,
  organizationId: string,
  body: Record<string, unknown>,
) {
  switch (route) {
    case "/v1/org/entity-types":
      return (
        await client.query(
          `INSERT INTO entity_types(organization_id, type_key, display_name, schema_definition)
         VALUES ($1, $2, $3, $4) RETURNING *`,
          [
            organizationId,
            body.key,
            body.displayName,
            JSON.stringify(body.schema ?? {}),
          ],
        )
      ).rows[0];
    case "/v1/org/relationship-types":
      return (
        await client.query(
          `INSERT INTO relationship_types(organization_id, type_key, display_name, from_entity_type, to_entity_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            organizationId,
            body.key,
            body.displayName,
            body.fromEntityType ?? null,
            body.toEntityType ?? null,
          ],
        )
      ).rows[0];
    case "/v1/org/roles": {
      const result = await client.query(
        "INSERT INTO organization_roles(organization_id, role_key, display_name) VALUES ($1, $2, $3) RETURNING *",
        [organizationId, body.key, body.displayName],
      );
      const permission = await client.query(
        "SELECT id FROM organization_permissions WHERE organization_id = $1 AND permission_key = 'user.read'",
        [organizationId],
      );
      if (!permission.rows[0])
        throw new Error("Organization profile permission is missing");
      await client.query(
        "INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope) VALUES ($1, $2, $3, 'own_user')",
        [organizationId, result.rows[0].id, permission.rows[0].id],
      );
      return result.rows[0];
    }
    case "/v1/org/permissions":
      return (
        await client.query(
          "INSERT INTO organization_permissions(organization_id, permission_key, description) VALUES ($1, $2, $3) RETURNING *",
          [organizationId, body.key, body.description ?? null],
        )
      ).rows[0];
    case "/v1/org/role-permissions": {
      const path = scopePath(body.scope as string);
      if (path) {
        const keys = [...new Set(path.map((step) => step.split(".")[1]))];
        const definitions = await client.query(
          "SELECT type_key FROM relationship_types WHERE organization_id = $1 AND type_key = ANY($2::text[])",
          [organizationId, keys],
        );
        if (definitions.rows.length !== keys.length)
          throw new ConfigurationError(422, "unknown_relationship_type");
      }
      const result = await client.query(
        `INSERT INTO organization_role_permissions(organization_id, role_id, permission_id, scope)
         SELECT $1, r.id, p.id, $4 FROM organization_roles r
         JOIN organization_permissions p ON p.organization_id = r.organization_id
         WHERE r.organization_id = $1 AND r.role_key = $2 AND p.permission_key = $3 RETURNING *`,
        [organizationId, body.roleKey, body.permissionKey, body.scope],
      );
      if (!result.rows[0])
        throw new ConfigurationError(404, "role_or_permission_not_found");
      return result.rows[0];
    }
    default:
      throw new ConfigurationError(404, "not_found");
  }
}

export async function configureOrganization(
  pool: Pool,
  input: {
    userId: string;
    organizationId: string;
    route: string;
    body: Record<string, unknown>;
  },
): Promise<{ status: number; body: unknown }> {
  const client = await pool.connect();
  let writingResource = false;
  try {
    await client.query("BEGIN");
    const decision = await requirePermission(client, {
      ...input,
      permission: "org.configure",
    });
    if (!decision.granted && decision.reason === "authorization_unavailable")
      throw new Error("Authorization storage unavailable");
    const granted =
      decision.granted &&
      decision.scopes.includes("organization") &&
      (await hasOrganizationRole(client, { ...input, roleKey: "admin" }));
    // Same connection/transaction as the mutation. A failed audit prevents every write.
    await auditAuthorizationDecision(
      client,
      {
        userId: input.userId,
        organizationId: input.organizationId,
        permission: "org.configure",
        decision: granted ? "granted" : "denied",
        scope: "organization",
        route: input.route,
        reason: granted ? undefined : "admin_required",
        resource:
          typeof input.body.key === "string" ? input.body.key : undefined,
      },
      true,
    );
    if (!granted) {
      await client.query("COMMIT");
      return { status: 403, body: { error: "forbidden" } };
    }
    validateBody(input.route, input.body);
    writingResource = true;
    const resource = await insertConfiguration(
      client,
      input.route,
      input.organizationId,
      input.body,
    );
    writingResource = false;
    await client.query("COMMIT");
    return { status: 201, body: resource };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof ConfigurationError)
      return { status: error.status, body: { error: error.code } };
    if (!writingResource) throw error;
    const code = (error as { code?: string })?.code;
    if (code === "23505")
      return { status: 409, body: { error: "already_exists" } };
    if (code === "23503" || code === "23514")
      return { status: 422, body: { error: "invalid_reference" } };
    throw error;
  } finally {
    client.release();
  }
}
