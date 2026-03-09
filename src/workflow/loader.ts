import fs from "node:fs/promises";

import yaml from "js-yaml";

import { newError } from "../domain/errors.js";
import type { WorkflowDefinition } from "../domain/types.js";

export function resolveWorkflowPath(explicit: string): string {
  return explicit.trim() ? explicit : "./WORKFLOW.md";
}

export async function load(path: string): Promise<WorkflowDefinition> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    throw newError("missing_workflow_file", "unable to read workflow file", error);
  }
  const { config, body } = splitFrontMatter(raw);
  return {
    config,
    promptTemplate: body.trim(),
    path,
    loadedAt: new Date()
  };
}

function splitFrontMatter(raw: string): { config: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) {
    return { config: {}, body: raw };
  }
  let rest = raw.slice(3);
  if (rest.startsWith("\r\n")) {
    rest = rest.slice(2);
  } else if (rest.startsWith("\n")) {
    rest = rest.slice(1);
  }

  const idx = rest.indexOf("\n---");
  if (idx < 0) {
    throw newError("workflow_parse_error", "front matter was started but not terminated");
  }
  const frontMatter = rest.slice(0, idx);
  const body = rest.slice(idx + 4).replace(/^\n/, "");

  let parsed: unknown;
  try {
    parsed = yaml.load(frontMatter);
  } catch (error) {
    throw newError("workflow_parse_error", "invalid workflow front matter YAML", error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw newError("workflow_front_matter_not_a_map", "front matter root must be an object");
  }
  return { config: parsed as Record<string, unknown>, body };
}
