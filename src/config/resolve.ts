import os from "node:os";
import path from "node:path";

export function resolveEnvToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("$")) {
    return (process.env[trimmed.slice(1)] ?? "").trim();
  }
  return trimmed;
}

export function expandPathValue(raw: string): string {
  if (!raw) {
    return raw;
  }
  let resolved = raw;
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  resolved = resolved.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => process.env[name] ?? "");
  try {
    return path.resolve(resolved);
  } catch {
    return resolved;
  }
}
