export function normalizeState(state: string): string {
  return state.trim().toLowerCase();
}

export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function composeSessionId(threadId: string, turnId: string): string {
  return `${threadId}-${turnId}`;
}
