import type { Pool } from "pg";
import { getAccessibleEntityIds, requirePermission } from "./authorization.js";
import { isUuid } from "./organization-config.js";
import type { ToolCall, ToolDefinition } from "./llm-client.js";

export interface ToolContext {
  userId: string;
  organizationId: string;
}
export interface EntitySource {
  entityType: string;
  entityId: string;
  summary: string;
}
export interface EntityAccess {
  entityType: string;
  entityId: string;
  action: string;
}
interface Entity {
  id: string;
  entity_type: string;
  data: Record<string, unknown>;
}
export interface ToolResult {
  data: unknown;
  sources: EntitySource[];
  accesses: EntityAccess[];
}
const key = { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" };
const uuid = { type: "string", format: "uuid" };
const definition = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolDefinition => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
export const aiTools: readonly ToolDefinition[] = [
  definition(
    "list_accessible_entities",
    "List a bounded page of authorized entities of a configured type. Requires <entityType>.read.",
    { entityType: key, limit: { type: "integer", minimum: 1, maximum: 50 } },
    ["entityType"],
  ),
  definition(
    "get_entity_details",
    "Get details of an entity within the current user's authorized scope.",
    { entityId: uuid },
    ["entityId"],
  ),
  definition(
    "get_entity_relationships",
    "Get active relationships only when both endpoints are authorized. Returns at most 50.",
    { entityId: uuid, relationshipType: key },
    ["entityId"],
  ),
  definition(
    "get_current_user_context",
    "Get your own profile, roles, organization and authorized counts by entity type.",
    {},
    [],
  ),
];

class ToolInputError extends Error {}
const isKey = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
const empty = (data: unknown): ToolResult => ({
  data,
  sources: [],
  accesses: [],
});

export async function loadUserContext(
  db: Pick<Pool, "query">,
  context: ToolContext,
) {
  const profile = await db.query<{ email: string; organization_name: string }>(
    `SELECT u.email, o.name AS organization_name FROM users u
     JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
     JOIN organizations o ON o.id = m.organization_id
     WHERE u.id = $1 AND o.id = $2`,
    [context.userId, context.organizationId],
  );
  if (!profile.rows[0]) throw new Error("Active membership unavailable");
  const roles = await db.query<{ role_key: string }>(
    `SELECT r.role_key FROM organization_roles r JOIN memberships m ON m.organization_id = r.organization_id
     WHERE m.user_id = $1 AND m.organization_id = $2 AND m.status = 'active'
       AND (EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.membership_id = m.id AND mr.organization_id = m.organization_id AND mr.role = r.role_key)
         OR EXISTS (SELECT 1 FROM organization_membership_roles mr WHERE mr.membership_id = m.id AND mr.organization_id = m.organization_id AND mr.role_id = r.id))
     ORDER BY r.role_key`,
    [context.userId, context.organizationId],
  );
  return {
    userId: context.userId,
    email: profile.rows[0].email,
    organization: {
      id: context.organizationId,
      name: profile.rows[0].organization_name,
    },
    roles: roles.rows.map((row) => row.role_key),
  };
}

/** The model can provide only validated tool arguments, never tenant or user IDs. */
export async function executeAiTool(
  db: Pick<Pool, "query">,
  context: ToolContext,
  call: ToolCall,
): Promise<ToolResult> {
  // Common gate also covers malformed and unknown calls. Type-specific reads
  // additionally require <type>.read inside getAccessibleEntityIds.
  const permission = await requirePermission(db, {
    ...context,
    permission: "user.read",
  });
  if (!permission.granted) {
    if (permission.reason === "authorization_unavailable")
      throw new Error("Authorization storage unavailable");
    return empty({ error: "forbidden" });
  }
  if (!permission.scopes.includes("own_user"))
    return empty({ error: "forbidden" });
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new ToolInputError();
    args = parsed as Record<string, unknown>;
    const tool = aiTools.find(
      (tool) => tool.function.name === call.function.name,
    );
    if (!tool) throw new ToolInputError();
    const allowed = Object.keys(tool.function.parameters.properties as object);
    if (Object.keys(args).some((name) => !allowed.includes(name)))
      throw new ToolInputError();
    if (
      call.function.name === "list_accessible_entities" &&
      (!isKey(args.entityType) ||
        (args.limit !== undefined &&
          (typeof args.limit !== "number" ||
            !Number.isInteger(args.limit) ||
            args.limit < 1 ||
            args.limit > 50)))
    )
      throw new ToolInputError();
    if (
      ["get_entity_details", "get_entity_relationships"].includes(
        call.function.name,
      ) &&
      !isUuid(args.entityId)
    )
      throw new ToolInputError();
    if (args.relationshipType !== undefined && !isKey(args.relationshipType))
      throw new ToolInputError();
  } catch {
    return empty({ error: "invalid_tool_arguments" });
  }

  const accesses: EntityAccess[] = [];
  const sources = new Map<string, EntitySource>();
  const record = (entity: Entity, action: string) => {
    const label =
      entity.data.display_name ?? entity.data.name ?? entity.data.title;
    sources.set(entity.id, {
      entityId: entity.id,
      entityType: entity.entity_type,
      summary:
        typeof label === "string"
          ? label.slice(0, 200)
          : `${entity.entity_type} ${entity.id}`,
    });
    accesses.push({
      entityId: entity.id,
      entityType: entity.entity_type,
      action,
    });
    return {
      entityId: entity.id,
      entityType: entity.entity_type,
      data: entity.data,
    };
  };
  // Cache only within one tool invocation; every subsequent tool rechecks RBAC.
  const accessible = new Map<string, string[]>();
  const idsFor = async (entityType: string) => {
    if (!accessible.has(entityType))
      accessible.set(
        entityType,
        await getAccessibleEntityIds(db, { ...context, entityType }),
      );
    return accessible.get(entityType)!;
  };
  const lookup = async (id: string): Promise<Entity | undefined> => {
    // Fetch metadata first; protected JSON is read only after scope validation.
    const metadata = await db.query<{ entity_type: string }>(
      "SELECT entity_type FROM entities WHERE organization_id = $1 AND id = $2",
      [context.organizationId, id],
    );
    const type = metadata.rows[0]?.entity_type;
    if (!type || !(await idsFor(type)).includes(id)) return undefined;
    return (
      await db.query<Entity>(
        "SELECT id, entity_type, data FROM entities WHERE organization_id = $1 AND id = $2",
        [context.organizationId, id],
      )
    ).rows[0];
  };
  let data: unknown;
  switch (call.function.name) {
    case "list_accessible_entities": {
      const ids = await idsFor(args.entityType as string);
      const limit = (args.limit as number | undefined) ?? 50;
      const entities = await db.query<Entity>(
        "SELECT id, entity_type, data FROM entities WHERE organization_id = $1 AND entity_type = $2 AND id = ANY($3::uuid[]) ORDER BY id LIMIT $4",
        [context.organizationId, args.entityType, ids, limit],
      );
      data = {
        entities: entities.rows.map((entity) => record(entity, "list")),
        truncated: ids.length > limit,
      };
      break;
    }
    case "get_entity_details": {
      const entity = await lookup(args.entityId as string);
      data = entity
        ? { entity: record(entity, "details") }
        : { error: "not_found_or_forbidden" };
      break;
    }
    case "get_entity_relationships": {
      const entity = await lookup(args.entityId as string);
      if (!entity) return empty({ error: "not_found_or_forbidden" });
      const candidates = await db.query<{
        id: string;
        relationship_type: string;
        from_entity_id: string;
        to_entity_id: string;
      }>(
        `SELECT id, relationship_type, from_entity_id, to_entity_id FROM relationships
         WHERE organization_id = $1 AND active AND (from_entity_id = $2 OR to_entity_id = $2)
           AND ($3::text IS NULL OR relationship_type = $3) ORDER BY id`,
        [context.organizationId, entity.id, args.relationshipType ?? null],
      );
      const relationships: unknown[] = [];
      for (const relation of candidates.rows) {
        const other = await lookup(
          relation.from_entity_id === entity.id
            ? relation.to_entity_id
            : relation.from_entity_id,
        );
        if (!other) continue;
        // Context is returned only after both endpoints pass their own read grant.
        const row = await db.query<{ context: unknown }>(
          "SELECT context FROM relationships WHERE organization_id = $1 AND id = $2 AND active",
          [context.organizationId, relation.id],
        );
        if (!row.rows[0]) continue;
        record(entity, "relationships");
        record(other, "relationships");
        relationships.push({ ...relation, context: row.rows[0].context });
        if (relationships.length === 50) break;
      }
      data = { relationships, limit: 50 };
      break;
    }
    case "get_current_user_context": {
      const profile = await loadUserContext(db, context);
      const types = await db.query<{ type_key: string }>(
        "SELECT type_key FROM entity_types WHERE organization_id = $1 ORDER BY type_key",
        [context.organizationId],
      );
      const counts: Record<string, number> = {};
      for (const { type_key: type } of types.rows) {
        const ids = await idsFor(type);
        counts[type] = ids.length;
        for (const id of ids)
          accesses.push({ entityType: type, entityId: id, action: "count" });
      }
      data = { ...profile, accessibleEntityCounts: counts };
      break;
    }
    default:
      return empty({ error: "unknown_tool" });
  }
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > 64 * 1024)
    return {
      data: {
        error: "result_too_large",
        hint: "Request fewer entities or a specific entity.",
      },
      sources: [],
      accesses,
    };
  return { data, sources: [...sources.values()], accesses };
}
