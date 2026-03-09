import { containsState } from "./dispatch.js";
import type { Scheduler } from "./scheduler.js";
import type { ServiceConfig } from "../domain/types.js";

export async function reconcileRunning(s: Scheduler, signal: AbortSignal, cfg: ServiceConfig): Promise<void> {
  const ids = Object.keys(s.store.state.running);
  for (const id of ids) {
    const running = s.store.state.running[id];
    if (!running) {
      continue;
    }
    if (cfg.codex.stallTimeoutMs > 0) {
      const ref = running.lastEventAt ?? running.startedAt;
      if (Date.now() - ref.getTime() > cfg.codex.stallTimeoutMs) {
        running.cancel();
        s.logger.warn("stalled run cancelled", "issue_id", id, "issue_identifier", running.issue.identifier);
      }
    }
  }

  let states: Record<string, string>;
  try {
    states = await s.tracker.fetchIssueStatesByIds(signal, ids);
  } catch (error) {
    s.logger.warn("running-state refresh failed; keeping workers active", "error", String(error));
    return;
  }

  for (const [id, running] of Object.entries(s.store.state.running)) {
    const state = states[id];
    if (!state) {
      continue;
    }
    running.issue.state = state;
    if (containsState(cfg.tracker.terminalStates, state)) {
      running.cancel();
      void s.workspace.removeWorkspace(AbortSignal.timeout(5000), running.issue.identifier);
      s.logger.info("terminal issue detected, cancelled run and cleaning workspace", "issue_id", id, "state", state);
      continue;
    }
    if (!containsState(cfg.tracker.activeStates, state)) {
      running.cancel();
      s.logger.info("issue no longer active, cancelled run", "issue_id", id, "state", state);
    }
  }
}

export function fetchIssueIsActive(cfg: ServiceConfig, state: string): boolean {
  return containsState(cfg.tracker.activeStates, state) && !containsState(cfg.tracker.terminalStates, state);
}
