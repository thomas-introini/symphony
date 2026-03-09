import { Liquid } from "liquidjs";

import { newError } from "../domain/errors.js";
import type { Issue, WorkflowDefinition } from "../domain/types.js";

export const fallbackPrompt = "You are working on an issue from GitHub.";

const engine = new Liquid({ strictVariables: true, strictFilters: true, jsTruthy: true });

export async function renderPrompt(def: WorkflowDefinition, issue: Issue, attempt: number | null): Promise<string> {
  const tplText = def.promptTemplate || fallbackPrompt;
  let tpl;
  try {
    tpl = engine.parse(tplText);
  } catch (error) {
    throw newError("template_parse_error", "failed to parse prompt template", error);
  }

  try {
    return await engine.render(tpl, {
      issue: withLegacyIssueAliases(issue),
      attempt,
      Attempt: attempt
    });
  } catch (error) {
    throw newError("template_render_error", "failed to render prompt template", error);
  }
}

function withLegacyIssueAliases(issue: Issue): Record<string, unknown> {
  return {
    ...issue,
    ID: issue.id,
    Identifier: issue.identifier,
    Title: issue.title,
    Description: issue.description,
    Priority: issue.priority,
    State: issue.state,
    BranchName: issue.branchName,
    URL: issue.url,
    Labels: issue.labels,
    BlockedBy: issue.blockedBy,
    CreatedAt: issue.createdAt,
    UpdatedAt: issue.updatedAt
  };
}
