type AnyMap = Record<string, unknown>;

export function extractUsage(payload: AnyMap | undefined): Record<string, number> | undefined {
  if (!payload) {
    return undefined;
  }
  const abs: Record<string, number> = {};
  copyIfNumAliases(payload, abs, "input_tokens", "inputTokens");
  copyIfNumAliases(payload, abs, "output_tokens", "outputTokens");
  copyIfNumAliases(payload, abs, "total_tokens", "totalTokens");
  const usage = asMap(payload.usage);
  if (usage) {
    copyIfNumAliases(usage, abs, "input_tokens", "inputTokens");
    copyIfNumAliases(usage, abs, "output_tokens", "outputTokens");
    copyIfNumAliases(usage, abs, "total_tokens", "totalTokens");
  }
  const totalTokenUsage = asMap(payload.total_token_usage);
  if (totalTokenUsage) {
    copyIfNumAliases(totalTokenUsage, abs, "input_tokens", "inputTokens");
    copyIfNumAliases(totalTokenUsage, abs, "output_tokens", "outputTokens");
    copyIfNumAliases(totalTokenUsage, abs, "total_tokens", "totalTokens");
  }
  const tokenUsage = asMap(payload.token_usage);
  if (tokenUsage) {
    copyIfNumAliases(tokenUsage, abs, "input_tokens", "inputTokens");
    copyIfNumAliases(tokenUsage, abs, "output_tokens", "outputTokens");
    copyIfNumAliases(tokenUsage, abs, "total_tokens", "totalTokens");
  }
  const thread = asMap(payload.thread);
  const threadTokenUsage = asMap(thread?.tokenUsage);
  if (threadTokenUsage) {
    copyIfNumAliases(threadTokenUsage, abs, "input_tokens", "inputTokens");
    copyIfNumAliases(threadTokenUsage, abs, "output_tokens", "outputTokens");
    copyIfNumAliases(threadTokenUsage, abs, "total_tokens", "totalTokens");
  }
  return Object.keys(abs).length > 0 ? abs : undefined;
}

export function extractRateLimits(payload: AnyMap | undefined): Record<string, unknown> | undefined {
  if (!payload) {
    return undefined;
  }
  for (const key of ["rate_limits", "rateLimits", "rate_limit", "rateLimit"]) {
    const value = asMap(payload[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function extractThreadIdFromResponse(raw: AnyMap): string {
  return firstString(raw, "result.thread.id", "result.threadId", "result.thread_id", "thread.id", "threadId", "thread_id");
}

export function extractTurnIdFromResponse(raw: AnyMap): string {
  return firstString(raw, "result.turn.id", "result.turnId", "result.turn_id", "turn.id", "turnId", "turn_id");
}

export function extractMethod(msg: AnyMap): string {
  for (const key of ["method", "event", "type", "name"]) {
    const s = msg[key];
    if (typeof s === "string" && s.trim()) {
      return normalizeMethod(s);
    }
  }
  const params = asMap(msg.params);
  if (params) {
    for (const key of ["method", "event", "type", "name"]) {
      const s = params[key];
      if (typeof s === "string" && s.trim()) {
        return normalizeMethod(s);
      }
    }
  }
  return "";
}

export function normalizeMethod(v: string): string {
  return v.trim().toLowerCase().replace(/^notifications?\//, "").replace(/^events?\//, "");
}

export function classifyTurnMessage(method: string, params: AnyMap | undefined): string {
  let current = method;
  if (!current) {
    current = normalizeMethod(firstString(params ?? {}, "event", "method", "type", "name"));
  }
  if (current === "turn/completed" || current.endsWith("/turn/completed")) {
    return "completed";
  }
  if (current === "turn/failed" || current.endsWith("/turn/failed")) {
    return "failed";
  }
  if (current === "turn/cancelled" || current.endsWith("/turn/cancelled") || current.endsWith("/turn/canceled")) {
    return "cancelled";
  }
  if (current === "item/tool/requestuserinput" || current === "turn/input_required" || current.endsWith("/request_user_input")) {
    return "input_required";
  }
  if (requiresInput(params)) {
    return "input_required";
  }
  const status = normalizeMethod(firstString(params ?? {}, "status", "turn.status"));
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled" || status === "canceled") {
    return "cancelled";
  }
  return "";
}

export function isApprovalRequest(method: string, msg: AnyMap): boolean {
  if (method.includes("approval")) {
    return true;
  }
  const params = asMap(msg.params);
  if (!params) {
    return false;
  }
  return Boolean(params.requires_approval) || Boolean(params.requiresApproval);
}

export function isToolCall(method: string): boolean {
  return method === "item/tool/call" || method === "tool/call" || method.endsWith("/tool/call");
}

function requiresInput(params: AnyMap | undefined): boolean {
  if (!params) {
    return false;
  }
  return Boolean(params.input_required) || Boolean(params.requires_input) || Boolean(params.requiresInput);
}

function copyIfNumAliases(src: AnyMap, dst: Record<string, number>, canonical: string, ...aliases: string[]): void {
  for (const key of [canonical, ...aliases]) {
    const n = toInt(src[key]);
    if (n !== null) {
      dst[canonical] = n;
      return;
    }
  }
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  return null;
}

function firstString(root: AnyMap, ...paths: string[]): string {
  for (const path of paths) {
    const parts = path.split(".");
    let current: unknown = root;
    let ok = true;
    for (const part of parts) {
      const m = asMap(current);
      if (!m) {
        ok = false;
        break;
      }
      current = m[part];
      if (current === undefined) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      continue;
    }
    if (typeof current === "string" && current.trim()) {
      return current;
    }
  }
  return "";
}

function asMap(v: unknown): AnyMap | null {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as AnyMap;
  }
  return null;
}
