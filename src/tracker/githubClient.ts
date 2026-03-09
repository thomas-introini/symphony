import { newError } from "../domain/errors.js";
import { normalizeState } from "../domain/normalize.js";
import type { Issue, TrackerConfig } from "../domain/types.js";
import type { TrackerClient } from "./client.js";
import {
  candidateIssuesQuery,
  projectStatusTransitionQuery,
  statesByIdsQuery,
  updateProjectItemStatusMutation
} from "./githubQueries.js";
import { normalizeIssue } from "./normalizeIssue.js";

type AnyMap = Record<string, unknown>;

export interface TrackerLogger {
  info(msg: string, ...kv: unknown[]): void;
  warn(msg: string, ...kv: unknown[]): void;
}

export class GitHubClient implements TrackerClient {
  private readonly cfg: TrackerConfig;
  private readonly logger: TrackerLogger;

  constructor(cfg: TrackerConfig, logger: TrackerLogger) {
    this.cfg = cfg;
    this.logger = logger;
  }

  async fetchCandidateIssues(signal: AbortSignal): Promise<Issue[]> {
    const all = await this.fetchProjectIssues(signal);
    return all.filter((issue) => containsState(this.cfg.activeStates, issue.state));
  }

  async fetchIssuesByStates(signal: AbortSignal, stateNames: string[]): Promise<Issue[]> {
    const all = await this.fetchProjectIssues(signal);
    return all.filter((issue) => containsState(stateNames, issue.state));
  }

  async fetchIssueStatesByIds(signal: AbortSignal, issueIds: string[]): Promise<Record<string, string>> {
    if (issueIds.length === 0) {
      return {};
    }
    const payload = await this.graphql(signal, statesByIdsQuery, {
      ids: issueIds,
      owner: this.cfg.owner,
      repo: this.cfg.repo,
      projectNumber: this.cfg.projectNumber
    });
    const { nodes } = this.extractItems(payload);
    const out: Record<string, string> = {};
    for (const n of nodes) {
      const content = asMap(n.content);
      const id = asString(content?.id);
      if (!id || !issueIds.includes(id)) {
        continue;
      }
      let state = "";
      const fieldValues = asMap(n.fieldValues);
      const rows = Array.isArray(fieldValues?.nodes) ? fieldValues.nodes : [];
      for (const rowRaw of rows) {
        const row = asMap(rowRaw);
        if (!row) {
          continue;
        }
        if (nestedFieldName(row).toLowerCase() === this.cfg.statusFieldName.toLowerCase()) {
          state = asString(row.name);
        }
      }
      if (state) {
        out[id] = state;
      }
    }
    return out;
  }

  async transitionIssueToState(signal: AbortSignal, issueId: string, stateName: string): Promise<void> {
    if (!issueId.trim() || !stateName.trim()) {
      return;
    }

    const target = await this.resolveTransitionTarget(signal, issueId, stateName);
    if (!target) {
      throw newError("github_unknown_payload", `unable to resolve transition target for issue=${issueId} state=${stateName}`);
    }

    await this.graphql(signal, updateProjectItemStatusMutation, {
      projectId: target.projectId,
      itemId: target.itemId,
      fieldId: target.fieldId,
      optionId: target.optionId
    });
  }

  private async fetchProjectIssues(signal: AbortSignal): Promise<Issue[]> {
    const issues: Issue[] = [];
    let after = "";
    while (true) {
      const payload = await this.graphql(signal, candidateIssuesQuery, {
        owner: this.cfg.owner,
        repo: this.cfg.repo,
        projectNumber: this.cfg.projectNumber,
        after: after || null,
        first: 50
      });

      const { nodes, pageInfo } = this.extractItems(payload);
      for (const node of nodes) {
        const { issue } = normalizeIssue(
          this.cfg.owner,
          this.cfg.repo,
          node,
          this.cfg.statusFieldName,
          this.cfg.priorityFieldName
        );
        if (issue) {
          issues.push(issue);
        }
      }

      if (!pageInfo.hasNextPage) {
        break;
      }
      if (!pageInfo.endCursor) {
        throw newError("github_missing_end_cursor", "missing end cursor during pagination");
      }
      after = pageInfo.endCursor;
    }
    return issues;
  }

  private async resolveTransitionTarget(
    signal: AbortSignal,
    issueId: string,
    stateName: string
  ): Promise<{ projectId: string; itemId: string; fieldId: string; optionId: string } | null> {
    let after = "";
    while (true) {
      const payload = await this.graphql(signal, projectStatusTransitionQuery, {
        owner: this.cfg.owner,
        repo: this.cfg.repo,
        projectNumber: this.cfg.projectNumber,
        after: after || null
      });

      const data = asMap(payload.data);
      const repo = asMap(data?.repository);
      const project = asMap(repo?.projectV2);
      if (!project) {
        throw newError("github_unknown_payload", "missing projectV2 node");
      }
      const projectId = asString(project.id);

      const fields = asMap(project.fields);
      const fieldNodes = Array.isArray(fields?.nodes) ? fields.nodes : [];
      let statusFieldId = "";
      let optionId = "";
      for (const rowRaw of fieldNodes) {
        const row = asMap(rowRaw);
        if (!row) {
          continue;
        }
        if (asString(row.name).toLowerCase() !== this.cfg.statusFieldName.toLowerCase()) {
          continue;
        }
        statusFieldId = asString(row.id);
        const options = Array.isArray(row.options) ? row.options : [];
        for (const optRaw of options) {
          const opt = asMap(optRaw);
          if (!opt) {
            continue;
          }
          if (asString(opt.name).toLowerCase() === stateName.toLowerCase()) {
            optionId = asString(opt.id);
            break;
          }
        }
      }

      const items = asMap(project.items);
      const itemNodes = Array.isArray(items?.nodes) ? items.nodes : [];
      let itemId = "";
      for (const rowRaw of itemNodes) {
        const row = asMap(rowRaw);
        if (!row) {
          continue;
        }
        const content = asMap(row.content);
        if (asString(content?.id) === issueId) {
          itemId = asString(row.id);
          break;
        }
      }

      if (projectId && statusFieldId && optionId && itemId) {
        return { projectId, itemId, fieldId: statusFieldId, optionId };
      }

      const pageInfo = asMap(items?.pageInfo);
      const hasNextPage = Boolean(pageInfo?.hasNextPage);
      const endCursor = asString(pageInfo?.endCursor);
      if (!hasNextPage) {
        return null;
      }
      if (!endCursor) {
        throw newError("github_missing_end_cursor", "missing end cursor during transition target pagination");
      }
      after = endCursor;
    }
  }

  private extractItems(payload: AnyMap): { nodes: AnyMap[]; pageInfo: { hasNextPage: boolean; endCursor: string } } {
    const data = asMap(payload.data);
    if (!data) {
      throw newError("github_unknown_payload", "missing data node");
    }
    const repo = asMap(data.repository);
    if (!repo) {
      throw newError("github_unknown_payload", "missing repository node");
    }
    const project = asMap(repo.projectV2);
    if (!project) {
      throw newError("github_unknown_payload", "missing projectV2 node");
    }
    const items = asMap(project.items);
    if (!items) {
      throw newError("github_unknown_payload", "missing items node");
    }
    const nodesRaw = Array.isArray(items.nodes) ? items.nodes : [];
    const nodes = nodesRaw.map(asMap).filter((v): v is AnyMap => Boolean(v));
    const pageInfo = asMap(items.pageInfo);
    return {
      nodes,
      pageInfo: {
        hasNextPage: Boolean(pageInfo?.hasNextPage),
        endCursor: asString(pageInfo?.endCursor)
      }
    };
  }

  private async graphql(signal: AbortSignal, query: string, variables: Record<string, unknown>): Promise<AnyMap> {
    const timeout = AbortSignal.timeout(30000);
    const merged = AbortSignal.any([signal, timeout]);
    const endpoint = this.cfg.endpoint.trim() || "https://api.github.com/graphql";
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        signal: merged,
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, variables })
      });
    } catch (error) {
      throw newError("github_api_request", "github request failed", error);
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 2048);
      throw newError("github_api_status", `github status=${res.status} body=${body}`);
    }
    let payload: unknown;
    try {
      payload = await res.json();
    } catch (error) {
      throw newError("github_unknown_payload", "invalid github JSON payload", error);
    }
    const map = asMap(payload);
    if (!map) {
      throw newError("github_unknown_payload", "payload is not an object");
    }
    if (map.errors) {
      throw newError("github_graphql_errors", `github graphql returned errors: ${summarizeGraphQlErrors(map.errors)}`);
    }
    return map;
  }
}

function containsState(states: string[], state: string): boolean {
  const n = normalizeState(state);
  return states.some((candidate) => normalizeState(candidate) === n);
}

function summarizeGraphQlErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "unknown graphql error payload";
  }
  const parts = errors
    .map(asMap)
    .filter((v): v is AnyMap => Boolean(v))
    .map((row) => asString(row.message).trim())
    .filter((msg) => Boolean(msg))
    .slice(0, 3);
  if (parts.length === 0) {
    return "unknown graphql error payload";
  }
  return parts.join(" | ");
}

function nestedFieldName(row: AnyMap): string {
  const field = asMap(row.field);
  return asString(field?.name);
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
