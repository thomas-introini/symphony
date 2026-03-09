import { normalizeState } from "../domain/normalize.js";
import type { Issue, ServiceConfig, WorkflowDefinition } from "../domain/types.js";
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
    attempt: number | null,
    onEvent: (evt: AppServerEvent) => void
  ): Promise<void> {
    const { def, cfg } = this.provider.current();
    const ws = await this.workspace.ensureWorkspace(signal, issue.identifier);
    validateCwd(ws.path, ws.path);
    await this.workspace.beforeRun(signal, ws.path);

    try {
      const prompt = await renderPrompt(def, issue, attempt);
      const client = new AppServerClient(cfg.codex.command, cfg.codex.readTimeoutMs, cfg.codex.turnTimeoutMs, this.logger);
      await client.start(signal, ws.path);
      try {
        const threadId = await client.initialize(signal, ws.path, cfg.codex.approvalPolicy, cfg.codex.threadSandbox);

        let turnCount = 0;
        while (turnCount < cfg.agent.maxTurns) {
          const turnInput =
            turnCount === 0
              ? prompt
              : "Continue working on the issue using the existing thread context, then report progress.";
          await client.runTurn(
            signal,
            threadId,
            turnInput,
            ws.path,
            `${issue.identifier}: ${issue.title}`,
            cfg.codex.approvalPolicy,
            cfg.codex.turnSandboxPolicy,
            onEvent
          );
          turnCount += 1;

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
      } finally {
        client.stop();
      }
    } finally {
      await this.workspace.afterRun(AbortSignal.timeout(2000), ws.path);
    }
  }
}

export function containsState(states: string[], state: string): boolean {
  const n = normalizeState(state);
  return states.some((s) => normalizeState(s) === n);
}
