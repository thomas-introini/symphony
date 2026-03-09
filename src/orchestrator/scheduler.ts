import { validatePreflight } from "../config/validate.js";
import type { RunnerMode } from "../agent/runner.js";
import type { Runner } from "../agent/runner.js";
import type { ServiceConfig, WorkflowDefinition } from "../domain/types.js";
import { addRunDurationSeconds } from "../observability/metrics.js";
import { verboseOpsEnabled } from "../observability/flags.js";
import type { TrackerClient } from "../tracker/client.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import { dispatchIssue, haveSlot, isEligible } from "./dispatch.js";
import { reconcileRunning } from "./reconcile.js";
import { onRetryFired, scheduleRetry } from "./retry.js";
import { RuntimeStore } from "./state.js";

export interface SchedulerLogger {
  info(msg: string, ...kv: unknown[]): void;
  warn(msg: string, ...kv: unknown[]): void;
  error(msg: string, ...kv: unknown[]): void;
}

export interface ConfigProvider {
  current(): { def: WorkflowDefinition; cfg: ServiceConfig };
}

interface WorkerResult {
  issueId: string;
  issue: import("../domain/types.js").Issue;
  attempt: number;
  startedAt: Date;
  error: unknown;
  mode: RunnerMode;
}

export class Scheduler {
  readonly store: RuntimeStore;
  private runSignal: AbortSignal | null = null;

  constructor(
    readonly provider: ConfigProvider,
    readonly tracker: TrackerClient,
    readonly runner: Runner,
    readonly workspace: WorkspaceManager,
    readonly logger: SchedulerLogger,
    cfg: ServiceConfig
  ) {
    this.store = new RuntimeStore(cfg);
  }

  async run(signal: AbortSignal): Promise<void> {
    this.runSignal = signal;
    try {
      await this.startupCleanup(signal);
    } catch (error) {
      this.logger.warn("startup terminal cleanup failed", "error", String(error));
    }

    while (!signal.aborted) {
      const { cfg } = this.provider.current();
      this.store.state.pollIntervalMs = cfg.polling.intervalMs;
      this.store.state.maxConcurrentAgents = cfg.agent.maxConcurrentAgents;
      await this.tick(signal);
      await sleep(cfg.polling.intervalMs, signal);
    }
    for (const entry of Object.values(this.store.state.retryAttempts)) {
      if (entry.timerHandle) {
        clearTimeout(entry.timerHandle);
      }
    }
    this.runSignal = null;
  }

  async tick(signal: AbortSignal): Promise<void> {
    const { cfg } = this.provider.current();
    await reconcileRunning(this, signal, cfg);
    try {
      validatePreflight(cfg);
    } catch (error) {
      this.logger.warn("dispatch preflight failed; skipping dispatch", "error", String(error));
      return;
    }

    let candidates = [] as import("../domain/types.js").Issue[];
    try {
      candidates = await this.tracker.fetchCandidateIssues(signal);
    } catch (error) {
      this.logger.warn("candidate fetch failed", "error", String(error));
      return;
    }
    if (verboseOpsEnabled()) {
      this.logger.info("tick fetched candidates", "count", candidates.length);
    }

    candidates.sort((a, b) => {
      const pa = a.priority ?? 9999;
      const pb = b.priority ?? 9999;
      if (pa !== pb) {
        return pa - pb;
      }
      const ta = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const tb = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (ta !== tb) {
        return ta - tb;
      }
      return a.identifier.localeCompare(b.identifier);
    });

    let dispatched = 0;
    for (const issue of candidates) {
      if (!isEligible(this, issue, cfg)) {
        continue;
      }
      if (!haveSlot(this, issue, cfg)) {
        continue;
      }
      dispatchIssue(this, signal, issue, null);
      dispatched += 1;
    }
    if (verboseOpsEnabled()) {
      this.logger.info("tick dispatch complete", "dispatched", dispatched, "running", Object.keys(this.store.state.running).length);
    }
  }

  handleWorkerExit(result: WorkerResult): void {
    const { cfg } = this.provider.current();
    const running = this.store.state.running[result.issueId];
    delete this.store.state.running[result.issueId];
    this.store.state.completed[result.issueId] = true;
    if (running) {
      addRunDurationSeconds(this.store.state.codexTotals, running.startedAt);
    }

    if (!result.error) {
      if (result.mode === "planning") {
        return;
      }
      scheduleRetry(this, this.runSignal ?? new AbortController().signal, result.issue, 1, 1000, "continuation");
      return;
    }

    const next = result.attempt + 1;
    const delay = Math.min(10000 * 2 ** Math.max(next - 1, 0), cfg.agent.maxRetryBackoffMs);
    scheduleRetry(
      this,
      this.runSignal ?? new AbortController().signal,
      result.issue,
      next,
      delay,
      result.error instanceof Error ? result.error.message : String(result.error)
    );
  }

  async startupCleanup(signal: AbortSignal): Promise<void> {
    const { cfg } = this.provider.current();
    const issues = await this.tracker.fetchIssuesByStates(signal, cfg.tracker.terminalStates);
    await this.workspace.cleanupTerminal(signal, issues);
  }

  async onRetryFired(signal: AbortSignal, issueId: string): Promise<void> {
    await onRetryFired(this, signal, issueId);
  }
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
