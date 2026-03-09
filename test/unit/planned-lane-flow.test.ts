import { describe, expect, it } from "vitest";

import type { RunAgentAttemptOptions } from "../../src/agent/runner.js";
import type { Issue, ServiceConfig, WorkflowDefinition } from "../../src/domain/types.js";
import { dispatchIssue } from "../../src/orchestrator/dispatch.js";
import { Scheduler } from "../../src/orchestrator/scheduler.js";

describe("planned lane flow", () => {
  it("routes Ready issues through planning and transitions to Planned", async () => {
    const issue = makeIssue("Ready");
    const calls: string[] = [];
    const tracker = {
      async fetchCandidateIssues(): Promise<Issue[]> {
        return [];
      },
      async fetchIssuesByStates(): Promise<Issue[]> {
        return [];
      },
      async fetchIssueStatesByIds(): Promise<Record<string, string>> {
        return {};
      },
      async transitionIssueToState(_signal: AbortSignal, _issueId: string, stateName: string): Promise<void> {
        calls.push(`transition:${stateName}`);
      },
      async addIssueComment(_signal: AbortSignal, _issueId: string, body: string): Promise<void> {
        calls.push("comment");
        expect(body).toContain("<!-- symphony:implementation-plan -->");
      },
      async fetchLatestPlanComment(): Promise<string | null> {
        calls.push("fetch-plan");
        return null;
      }
    };

    const runner = {
      async runAgentAttempt(
        _signal: AbortSignal,
        _issue: Issue,
        options: RunAgentAttemptOptions,
        _onEvent: (evt: import("../../src/agent/protocol.js").AppServerEvent) => void
      ): Promise<{ plan: string | null }> {
        calls.push(`run:${options.mode}`);
        return { plan: "Step 1\nStep 2" };
      }
    };

    const scheduler = makeScheduler(tracker, runner);
    dispatchIssue(scheduler, AbortSignal.timeout(5000), issue, null);
    await waitForIssueExit(scheduler, issue.id);

    expect(calls).toEqual(["fetch-plan", "run:planning", "comment", "transition:Planned"]);
    expect(scheduler.store.state.retryAttempts[issue.id]).toBeUndefined();
  });

  it("routes Ready to implement issues with injected plan context", async () => {
    const issue = makeIssue("Ready to implement");
    const optionsSeen: { value: RunAgentAttemptOptions | null } = { value: null };
    const tracker = {
      async fetchCandidateIssues(): Promise<Issue[]> {
        return [];
      },
      async fetchIssuesByStates(): Promise<Issue[]> {
        return [];
      },
      async fetchIssueStatesByIds(): Promise<Record<string, string>> {
        return { [issue.id]: "In Progress" };
      },
      async transitionIssueToState(): Promise<void> {
        return;
      },
      async addIssueComment(): Promise<void> {
        return;
      },
      async fetchLatestPlanComment(): Promise<string | null> {
        return "<!-- symphony:implementation-plan -->\n\nUse parser helpers.";
      }
    };

    const runner = {
      async runAgentAttempt(
        _signal: AbortSignal,
        _issue: Issue,
        options: RunAgentAttemptOptions,
        _onEvent: (evt: import("../../src/agent/protocol.js").AppServerEvent) => void
      ): Promise<{ plan: string | null }> {
        optionsSeen.value = options;
        return { plan: null };
      }
    };

    const scheduler = makeScheduler(tracker, runner);
    dispatchIssue(scheduler, AbortSignal.timeout(5000), issue, null);
    await waitForIssueExit(scheduler, issue.id);

    expect(optionsSeen.value?.mode).toBe("implementation");
    expect(optionsSeen.value?.planContext).toContain("implementation-plan");
  });

  it("does not transition planning issue when comment post fails", async () => {
    const issue = makeIssue("Ready");
    let transitioned = false;
    const tracker = {
      async fetchCandidateIssues(): Promise<Issue[]> {
        return [];
      },
      async fetchIssuesByStates(): Promise<Issue[]> {
        return [];
      },
      async fetchIssueStatesByIds(): Promise<Record<string, string>> {
        return {};
      },
      async transitionIssueToState(): Promise<void> {
        transitioned = true;
      },
      async addIssueComment(): Promise<void> {
        throw new Error("comment failure");
      },
      async fetchLatestPlanComment(): Promise<string | null> {
        return null;
      }
    };

    const runner = {
      async runAgentAttempt(): Promise<{ plan: string | null }> {
        return { plan: "Plan" };
      }
    };

    const scheduler = makeScheduler(tracker, runner);
    dispatchIssue(scheduler, AbortSignal.timeout(5000), issue, null);
    await waitForIssueExit(scheduler, issue.id);

    expect(transitioned).toBe(false);
  });

  it("fails implementation run when no tagged plan exists", async () => {
    const issue = makeIssue("Ready to implement");
    let runnerCalled = false;
    const tracker = {
      async fetchCandidateIssues(): Promise<Issue[]> {
        return [];
      },
      async fetchIssuesByStates(): Promise<Issue[]> {
        return [];
      },
      async fetchIssueStatesByIds(): Promise<Record<string, string>> {
        return {};
      },
      async transitionIssueToState(): Promise<void> {
        return;
      },
      async addIssueComment(): Promise<void> {
        return;
      },
      async fetchLatestPlanComment(): Promise<string | null> {
        return null;
      }
    };

    const runner = {
      async runAgentAttempt(): Promise<{ plan: string | null }> {
        runnerCalled = true;
        return { plan: null };
      }
    };

    const scheduler = makeScheduler(tracker, runner);
    dispatchIssue(scheduler, AbortSignal.timeout(5000), issue, null);
    await waitForIssueExit(scheduler, issue.id);

    const retry = scheduler.store.state.retryAttempts[issue.id];
    expect(runnerCalled).toBe(false);
    expect(retry?.error).toContain("missing_plan_comment");
  });
});

function makeScheduler(tracker: unknown, runner: unknown): Scheduler {
  const cfg = makeConfig();
  const provider = {
    current(): { def: WorkflowDefinition; cfg: ServiceConfig } {
      return {
        def: { config: {}, promptTemplate: "", path: "", loadedAt: new Date() },
        cfg
      };
    }
  };
  const workspace = {
    cleanupTerminal: async (): Promise<void> => {},
    removeWorkspace: async (): Promise<void> => {}
  };
  const logger = {
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {}
  };
  return new Scheduler(
    provider,
    tracker as import("../../src/tracker/client.js").TrackerClient,
    runner as import("../../src/agent/runner.js").Runner,
    workspace as unknown as import("../../src/workspace/manager.js").WorkspaceManager,
    logger,
    cfg
  );
}

function makeConfig(): ServiceConfig {
  return {
    tracker: {
      kind: "github",
      endpoint: "",
      apiKey: "token",
      owner: "o",
      repo: "r",
      projectNumber: 1,
      activeStates: ["Ready", "Ready to implement", "In Progress"],
      terminalStates: ["Done"],
      statusFieldName: "Status",
      priorityFieldName: "Priority",
      planningSourceState: "Ready",
      planningTargetState: "Planned",
      implementationState: "Ready to implement",
      planCommentTag: "<!-- symphony:implementation-plan -->"
    },
    polling: { intervalMs: 1000 },
    workspace: { root: "" },
    hooks: { afterCreate: "", beforeRun: "", afterRun: "", beforeRemove: "", timeoutMs: 1 },
    agent: { maxConcurrentAgents: 1, maxTurns: 2, maxRetryBackoffMs: 2000, maxConcurrentAgentsByState: {} },
    codex: {
      command: "codex app-server",
      approvalPolicy: "",
      threadSandbox: "",
      turnSandboxPolicy: "",
      turnTimeoutMs: 1,
      readTimeoutMs: 1,
      stallTimeoutMs: 1
    }
  };
}

function makeIssue(state: string): Issue {
  return {
    id: "ISSUE_1",
    identifier: "#1",
    title: "test",
    description: "",
    priority: 1,
    state,
    branchName: "feature/test",
    url: "u",
    labels: [],
    blockedBy: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };
}

async function waitForIssueExit(scheduler: Scheduler, issueId: string): Promise<void> {
  const started = Date.now();
  while (scheduler.store.state.running[issueId]) {
    if (Date.now() - started > 2000) {
      throw new Error("issue did not exit running set");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
