export type UserRole = "visitor" | "client" | "staff" | "admin";
export type PermissionScope = "self" | "assigned" | "group" | "department" | "organization";

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
