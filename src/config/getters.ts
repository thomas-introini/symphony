import { normalizeState } from "../domain/normalize.js";
import type { ServiceConfig } from "../domain/types.js";

type AnyMap = Record<string, unknown>;

export function getString(root: AnyMap, section: string, key: string): string {
  const v = get(root, section, key);
  return typeof v === "string" ? v.trim() : "";
}

export function getInt(root: AnyMap, section: string, key: string, fallback: number): number {
  const v = get(root, section, key);
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const n = Number.parseInt(v.trim(), 10);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return fallback;
}

export function getStringList(root: AnyMap, section: string, key: string, fallback: string[]): string[] {
  const v = get(root, section, key);
  if (typeof v === "string") {
    const out = v
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (out.length > 0) {
      return out;
    }
  }
  if (Array.isArray(v)) {
    const out = v
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((part) => part.length > 0);
    if (out.length > 0) {
      return out;
    }
  }
  return [...fallback];
}

export function getStateConcurrency(root: AnyMap): Record<string, number> {
  const out: Record<string, number> = {};
  const v = get(root, "agent", "max_concurrent_agents_by_state");
  if (!isMap(v)) {
    return out;
  }
  for (const [k, raw] of Object.entries(v)) {
    const norm = normalizeState(k);
    if (!norm) {
      continue;
    }
    let n = 0;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      n = Math.trunc(raw);
    } else if (typeof raw === "string") {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(parsed)) {
        n = parsed;
      }
    }
    if (n > 0) {
      out[norm] = n;
    }
  }
  return out;
}

export function coalesce(v: string, fallback: string): string {
  return v.trim() === "" ? fallback : v;
}

export function clampPositive(v: number, fallback: number): number {
  return v <= 0 ? fallback : v;
}

export function dump(cfg: ServiceConfig): string {
  return `tracker=${cfg.tracker.kind} poll=${cfg.polling.intervalMs}ms workspace=${cfg.workspace.root}`;
}

function get(root: AnyMap, section: string, key: string): unknown {
  const sec = root[section];
  if (!isMap(sec)) {
    return undefined;
  }
  return sec[key];
}

function isMap(v: unknown): v is AnyMap {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
