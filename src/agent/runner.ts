import { normalizeState } from "../domain/normalize.js";
import { newError } from "../domain/errors.js";
import type { Issue, ServiceConfig, WorkflowDefinition } from "../domain/types.js";
import { verboseOpsEnabled } from "../observability/flags.js";
import { fetchIssueIsActive } from "../orchestrator/reconcile.js";
import type { TrackerClient } from "../tracker/client.js";
import { renderPrompt } from "../workflow/template.js";
import { validateCwd } from "../workspace/safety.js";
import { AppServerClient, type AgentLogger } from "./appServerClient.js";
import type { AppServerEvent } from "./protocol.js";
import type { WorkspaceManager } from "../workspace/manager.js";

export interface ConfigProvider {
  current(): { def: WorkflowDefinition; cfg: ServiceConfig };
}

export type RunnerMode = "planning" | "implementation";

export interface RunAgentAttemptOptions {
  attempt: number | null;
  mode: RunnerMode;
  planContext?: string;
}

export interface RunAgentAttemptResult {
  plan: string | null;
}

export class Runner {
  constructor(
    private readonly tracker: TrackerClient,
    private readonly workspace: WorkspaceManager,
    private readonly provider: ConfigProvider,
    private readonly logger: AgentLogger
  ) {}

  async runAgentAttempt(
    signal: AbortSignal,
    issue: Issue,
    options: RunAgentAttemptOptions,
    onEvent: (evt: AppServerEvent) => void
  ): Promise<RunAgentAttemptResult> {
    const { def, cfg } = this.provider.current();
    if (verboseOpsEnabled()) {
      this.logger.info(
        "runner start",
        "issue_id",
        issue.id,
        "issue_identifier",
        issue.identifier,
        "mode",
        options.mode,
        "attempt",
        options.attempt ?? 0
      );
    }
    const ws = await this.workspace.ensureWorkspace(signal, issue.identifier);
    await this.workspace.ensureIssueBranch(signal, ws.path, issue.identifier);
    validateCwd(ws.path, ws.path);
    await this.workspace.beforeRun(signal, ws.path);

    try {
      const prompt = await renderPrompt(def, issue, options.attempt);
      const firstTurnInput = buildFirstTurnInput(options.mode, prompt, options.planContext ?? "");
      const client = new AppServerClient(cfg.codex.command, cfg.codex.readTimeoutMs, cfg.codex.turnTimeoutMs, this.logger);
      await client.start(signal, ws.path);
      try {
        const threadId = await client.initialize(signal, ws.path, cfg.codex.approvalPolicy, cfg.codex.threadSandbox);

        let turnCount = 0;
        const maxTurns = options.mode === "planning" ? 1 : cfg.agent.maxTurns;
        const planningMessages = new Set<string>();
        while (turnCount < maxTurns) {
          const turnInput =
            turnCount === 0
              ? firstTurnInput
              : "Continue working on the issue using the existing thread context, then report progress.";
          await client.runTurn(
            signal,
            threadId,
            turnInput,
            ws.path,
            `${issue.identifier}: ${issue.title}`,
            cfg.codex.approvalPolicy,
            cfg.codex.turnSandboxPolicy,
            (evt) => {
              onEvent(evt);
              if (options.mode === "planning") {
                const text = evt.message.trim();
                if (text) {
                  planningMessages.add(text);
                }
              }
            }
          );
          turnCount += 1;
          if (verboseOpsEnabled()) {
            this.logger.info("runner turn complete", "issue_id", issue.id, "mode", options.mode, "turn", turnCount);
          }

          if (options.mode === "planning") {
            break;
          }

          const stateMap = await this.tracker.fetchIssueStatesByIds(signal, [issue.id]);
          const state = stateMap[issue.id];
          if (!state) {
            this.logger.warn("issue refresh failed after turn; stopping continuation", "issue_id", issue.id);
            break;
          }
          if (!fetchIssueIsActive(cfg, state)) {
            break;
          }
        }
        onEvent({
          event: "turn_completed",
          timestamp: new Date(),
          message: "",
          threadId,
          turnId: "",
          sessionId: "",
          usage: undefined,
            rateLimits: undefined
          });

        if (options.mode === "planning") {
          const plan = pickPlanningOutput(Array.from(planningMessages), firstTurnInput);
          if (!plan) {
            throw newError("planning_output_missing", "planning mode produced no plan content");
          }
          if (verboseOpsEnabled()) {
            this.logger.info("runner planning output ready", "issue_id", issue.id, "plan_length", plan.length);
          }
          return { plan };
        }
        return { plan: null };
      } finally {
        client.stop();
      }
    } finally {
      await this.workspace.afterRun(AbortSignal.timeout(2000), ws.path);
    }
  }
}

function buildFirstTurnInput(mode: RunnerMode, basePrompt: string, planContext: string): string {
  if (mode === "planning") {
    return `${basePrompt}\n\nPlanning task:\nProvide only a concise implementation plan for this issue. Do not write code or apply file changes.\nThe plan must include:\n1. Scope assumptions\n2. Concrete implementation steps\n3. Test/validation steps\n4. Risks or open questions`;
  }
  if (!planContext.trim()) {
    return basePrompt;
  }
  return `${basePrompt}\n\nPlan context:\n${planContext.trim()}\n\nFollow this plan while implementing, and note any intentional deviations.`;
}

function pickPlanningOutput(messages: string[], firstTurnInput: string): string {
  if (messages.length === 0) {
    return "";
  }
  const trimmedPrompt = firstTurnInput.trim();
  const candidates = messages
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .filter((m) => m !== trimmedPrompt)
    .filter((m) => !m.includes("Issue context:") || !m.includes("Planning task:"));
  if (candidates.length === 0) {
    return "";
  }
  return candidates[candidates.length - 1] ?? "";
}

export function containsState(states: string[], state: string): boolean {
  const n = normalizeState(state);
  return states.some((s) => normalizeState(s) === n);
}
