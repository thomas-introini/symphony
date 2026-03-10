import path from "node:path";

import { describe, expect, it } from "vitest";

import { SymphonyError } from "../../src/domain/errors.js";
import { buildServiceConfig } from "../../src/config/schema.js";
import { validatePreflight } from "../../src/config/validate.js";

describe("config", () => {
  it("builds defaults", () => {
    const cfg = buildServiceConfig({ config: {}, promptTemplate: "", path: "", loadedAt: new Date() });
    expect(cfg.tracker.endpoint).toBe("https://api.github.com/graphql");
    expect(cfg.polling.intervalMs).toBe(30000);
    expect(cfg.agent.maxConcurrentAgents).toBe(10);
    expect(cfg.codex.command).toBe("codex app-server");
    expect(cfg.tracker.activeStates).toHaveLength(2);
    expect(cfg.tracker.planningSourceState).toBe("Ready");
    expect(cfg.tracker.planningClaimState).toBe("Planning");
    expect(cfg.tracker.planningTargetState).toBe("Planned");
    expect(cfg.tracker.implementationState).toBe("Ready to implement");
    expect(cfg.tracker.planCommentTag).toBe("<!-- symphony:implementation-plan -->");
  });

  it("resolves env and coercions", () => {
    process.env.GH_TOKEN = "abc123";
    process.env.WROOT = path.join(process.cwd(), "tmp-w");
    const cfg = buildServiceConfig({
      config: {
        tracker: {
          kind: "github",
          api_key: "$GH_TOKEN",
          owner: "octo",
          repo: "repo",
          project_number: "12",
          active_states: "Todo, In Progress"
        },
        workspace: { root: "$WROOT" },
        agent: {
          max_concurrent_agents: "7",
          max_concurrent_agents_by_state: {
            " In Progress ": "2",
            Todo: -1,
            "": 4
          }
        }
      },
      promptTemplate: "",
      path: "",
      loadedAt: new Date()
    });

    expect(cfg.tracker.apiKey).toBe("abc123");
    expect(cfg.tracker.projectNumber).toBe(12);
    expect(cfg.agent.maxConcurrentAgents).toBe(7);
    expect(cfg.agent.maxConcurrentAgentsByState["in progress"]).toBe(2);
    expect(cfg.agent.maxConcurrentAgentsByState.todo).toBeUndefined();
    expect(cfg.workspace.root).not.toBe("");
  });

  it("validates preflight", () => {
    expect(() =>
      validatePreflight({
        tracker: {
          kind: "github",
          endpoint: "",
          apiKey: "x",
          owner: "o",
          repo: "r",
          projectNumber: 1,
          activeStates: [],
          terminalStates: [],
          statusFieldName: "",
          priorityFieldName: "",
          planningSourceState: "Ready",
          planningClaimState: "Planning",
          planningTargetState: "Planned",
          implementationState: "Ready to implement",
          planCommentTag: "<!-- symphony:implementation-plan -->"
        },
        polling: { intervalMs: 1 },
        workspace: { root: "" },
        hooks: { afterCreate: "", beforeRun: "", afterRun: "", beforeRemove: "", timeoutMs: 1 },
        agent: { maxConcurrentAgents: 1, maxTurns: 1, maxRetryBackoffMs: 1, maxConcurrentAgentsByState: {} },
        codex: {
          command: "codex app-server",
          approvalPolicy: "",
          threadSandbox: "",
          turnSandboxPolicy: "",
          turnTimeoutMs: 1,
          readTimeoutMs: 1,
          stallTimeoutMs: 1
        }
      })
    ).not.toThrow();

    expect(() =>
      validatePreflight({
        tracker: {
          kind: "linear",
          endpoint: "",
          apiKey: "x",
          owner: "o",
          repo: "r",
          projectNumber: 1,
          activeStates: [],
          terminalStates: [],
          statusFieldName: "",
          priorityFieldName: "",
          planningSourceState: "Ready",
          planningClaimState: "Planning",
          planningTargetState: "Planned",
          implementationState: "Ready to implement",
          planCommentTag: "<!-- symphony:implementation-plan -->"
        },
        polling: { intervalMs: 1 },
        workspace: { root: "" },
        hooks: { afterCreate: "", beforeRun: "", afterRun: "", beforeRemove: "", timeoutMs: 1 },
        agent: { maxConcurrentAgents: 1, maxTurns: 1, maxRetryBackoffMs: 1, maxConcurrentAgentsByState: {} },
        codex: { command: "x", approvalPolicy: "", threadSandbox: "", turnSandboxPolicy: "", turnTimeoutMs: 1, readTimeoutMs: 1, stallTimeoutMs: 1 }
      })
    ).toThrow(SymphonyError);

    expect(() =>
      validatePreflight({
        tracker: {
          kind: "github",
          endpoint: "",
          apiKey: "x",
          owner: "o",
          repo: "r",
          projectNumber: 1,
          activeStates: [],
          terminalStates: [],
          statusFieldName: "",
          priorityFieldName: "",
          planningSourceState: "",
          planningClaimState: "Planning",
          planningTargetState: "Planned",
          implementationState: "Ready to implement",
          planCommentTag: "<!-- symphony:implementation-plan -->"
        },
        polling: { intervalMs: 1 },
        workspace: { root: "" },
        hooks: { afterCreate: "", beforeRun: "", afterRun: "", beforeRemove: "", timeoutMs: 1 },
        agent: { maxConcurrentAgents: 1, maxTurns: 1, maxRetryBackoffMs: 1, maxConcurrentAgentsByState: {} },
        codex: { command: "x", approvalPolicy: "", threadSandbox: "", turnSandboxPolicy: "", turnTimeoutMs: 1, readTimeoutMs: 1, stallTimeoutMs: 1 }
      })
    ).toThrow(SymphonyError);

    expect(() =>
      validatePreflight({
        tracker: {
          kind: "github",
          endpoint: "",
          apiKey: "x",
          owner: "o",
          repo: "r",
          projectNumber: 1,
          activeStates: [],
          terminalStates: [],
          statusFieldName: "",
          priorityFieldName: "",
          planningSourceState: "Ready",
          planningClaimState: "",
          planningTargetState: "Planned",
          implementationState: "Ready to implement",
          planCommentTag: "<!-- symphony:implementation-plan -->"
        },
        polling: { intervalMs: 1 },
        workspace: { root: "" },
        hooks: { afterCreate: "", beforeRun: "", afterRun: "", beforeRemove: "", timeoutMs: 1 },
        agent: { maxConcurrentAgents: 1, maxTurns: 1, maxRetryBackoffMs: 1, maxConcurrentAgentsByState: {} },
        codex: { command: "x", approvalPolicy: "", threadSandbox: "", turnSandboxPolicy: "", turnTimeoutMs: 1, readTimeoutMs: 1, stallTimeoutMs: 1 }
      })
    ).toThrow(SymphonyError);
  });
});
