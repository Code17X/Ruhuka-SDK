export type UserRole = "visitor" | "client" | "staff" | "admin";

/**
 * Canonical scope vocabulary for authorization grants.
 * - own_user: The user's own global profile.
 * - linked_student: Exactly the one student linked to this client membership in the current org.
 * - assigned_class: Classes explicitly assigned to this staff membership in the current org.
 * - department: Departments explicitly assigned to this staff membership in the current org.
 * - organization: Organization-wide access (requires explicit grant, no implicit widening).
 */
export type PermissionScope = 
  | "own_user"
  | "linked_student"
  | "assigned_class"
  | "department"
  | "organization";

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  role: UserRole;
}

export interface SemanticAnchor {
  id: string;
  role?: string;
  label?: string;
  tagName: string;
  selectorHint?: string;
  confidence: number;
}

export interface PageObservation {
  url: string;
  title: string;
  pageType: string;
  headings: string[];
  links: string[];
  semanticAnchors: SemanticAnchor[];
}

export interface PermissionCheck {
  userId: string;
  organizationId: string;
  permission: string;
  resource: string;
  scope: PermissionScope;
  resourceOwnerId?: string;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

export interface AiMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface AiToolRequest {
  toolName: string;
  input: unknown;
}

export interface AiToolResult {
  toolName: string;
  output: unknown;
  authorized: boolean;
}