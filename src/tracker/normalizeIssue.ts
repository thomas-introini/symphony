import type { Issue } from "../domain/types.js";

type AnyMap = Record<string, unknown>;

export function normalizeIssue(
  owner: string,
  repo: string,
  node: AnyMap,
  statusFieldName: string,
  priorityFieldName: string
): { issue: Issue | null } {
  const content = asMap(node.content);
  if (!content) {
    return { issue: null };
  }

  const id = asString(content.id);
  const number = asInt(content.number);
  const title = asString(content.title);
  const body = asString(content.body);
  const url = asString(content.url);

  let state = "";
  let priority: number | null = null;
  const fieldValues = asMap(node.fieldValues);
  const fieldNodes = Array.isArray(fieldValues?.nodes) ? fieldValues.nodes : [];
  for (const item of fieldNodes) {
    const row = asMap(item);
    if (!row) {
      continue;
    }
    const fieldName = nestedFieldName(row);
    if (fieldName.localeCompare(statusFieldName, undefined, { sensitivity: "accent" }) === 0 || fieldName.toLowerCase() === statusFieldName.toLowerCase()) {
      state = asString(row.name);
    }
    if (fieldName.localeCompare(priorityFieldName, undefined, { sensitivity: "accent" }) === 0 || fieldName.toLowerCase() === priorityFieldName.toLowerCase()) {
      const n = row.number;
      if (typeof n === "number" && Number.isFinite(n)) {
        priority = Math.trunc(n);
      }
    }
  }

  const labels: string[] = [];
  const labelsObj = asMap(content.labels);
  const labelNodes = Array.isArray(labelsObj?.nodes) ? labelsObj.nodes : [];
  for (const item of labelNodes) {
    const m = asMap(item);
    if (!m) {
      continue;
    }
    const name = asString(m.name).trim().toLowerCase();
    if (name) {
      labels.push(name);
    }
  }

  const issue: Issue = {
    id,
    identifier: `${repo}#${number}`,
    title,
    description: body,
    priority,
    state,
    url,
    labels,
    blockedBy: [],
    createdAt: parseDate(content.createdAt),
    updatedAt: parseDate(content.updatedAt),
    branchName: `${owner}/${repo}/${number}`
  };
  if (!issue.id || !issue.identifier || !issue.title) {
    return { issue: null };
  }
  return { issue };
}

function nestedFieldName(row: AnyMap): string {
  const field = asMap(row.field);
  if (!field) {
    return "";
  }
  return asString(field.name);
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) {
    return null;
  }
  const d = new Date(v);
  return Number.isNaN(d.valueOf()) ? null : d;
}

function asMap(v: unknown): AnyMap | null {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as AnyMap;
  }
  return null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  return 0;
}
