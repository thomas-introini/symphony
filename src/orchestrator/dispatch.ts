import { normalizeState } from "../domain/normalize.js";
import type { Issue, ServiceConfig } from "../domain/types.js";
import { addSessionDeltas } from "../observability/metrics.js";
import type { Scheduler } from "./scheduler.js";
import { initialLiveSession } from "./state.js";

export function isEligible(s: Scheduler, issue: Issue, cfg: ServiceConfig): boolean {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }
  if (!containsState(cfg.tracker.activeStates, issue.state) || containsState(cfg.tracker.terminalStates, issue.state)) {
    return false;
  }
  if (s.store.state.running[issue.id]) {
    return false;
  }
  if (s.store.state.claimed[issue.id]) {
    return false;
  }
  if (normalizeState(issue.state) === "todo") {
    for (const blocker of issue.blockedBy) {
      if (!blocker.state || !containsState(cfg.tracker.terminalStates, blocker.state)) {
        return false;
      }
    }
  }
  return true;
}

export function haveSlot(s: Scheduler, issue: Issue, cfg: ServiceConfig): boolean {
  if (Object.keys(s.store.state.running).length >= cfg.agent.maxConcurrentAgents) {
    return false;
  }
  const norm = normalizeState(issue.state);
  const limit = cfg.agent.maxConcurrentAgentsByState[norm];
  if (!limit) {
    return true;
  }
  let count = 0;
  for (const running of Object.values(s.store.state.running)) {
    if (normalizeState(running.issue.state) === norm) {
      count += 1;
    }
  }
  return count < limit;
}

export function dispatchIssue(s: Scheduler, parentSignal: AbortSignal, issue: Issue, attempt: number | null): void {
  const runController = new AbortController();
  parentSignal.addEventListener("abort", () => runController.abort(), { once: true });
  const now = new Date();

  s.store.state.claimed[issue.id] = true;
  s.store.state.running[issue.id] = {
    issue,
    attempt,
    startedAt: now,
    cancel: () => runController.abort(),
    lastEventAt: now,
    session: initialLiveSession()
  };
  delete s.store.state.retryAttempts[issue.id];

  const attemptNum = attempt ?? 0;
  void (async () => {
    if (normalizeState(issue.state) !== normalizeState("In Progress")) {
      try {
        await s.tracker.transitionIssueToState(runController.signal, issue.id, "In Progress");
        issue.state = "In Progress";
      } catch (error) {
        s.logger.warn(
          "issue status transition failed; continuing run",
          "issue_id",
          issue.id,
          "issue_identifier",
          issue.identifier,
          "target_state",
          "In Progress",
          "error",
          String(error)
        );
      }
    }

    await s.runner.runAgentAttempt(runController.signal, issue, attempt, (evt) => {
      const cur = s.store.state.running[issue.id];
      if (!cur) {
        return;
      }
      cur.lastEventAt = evt.timestamp;
      cur.session.lastCodexEvent = evt.event;
      cur.session.lastCodexTimestamp = evt.timestamp;
      cur.session.sessionId = evt.sessionId;
      cur.session.threadId = evt.threadId;
      cur.session.turnId = evt.turnId;
      if (evt.usage) {
        addSessionDeltas(
          cur.session,
          evt.usage.input_tokens ?? 0,
          evt.usage.output_tokens ?? 0,
          evt.usage.total_tokens ?? 0
        );
      }
      if (evt.rateLimits) {
        s.store.state.codexRateLimits = evt.rateLimits;
      }
    });
  })().then(
    () => s.handleWorkerExit({ issueId: issue.id, issue, attempt: attemptNum, startedAt: now, error: null }),
    (error: unknown) => s.handleWorkerExit({ issueId: issue.id, issue, attempt: attemptNum, startedAt: now, error })
  );
}

export function containsState(states: string[], state: string): boolean {
  const n = normalizeState(state);
  return states.some((candidate) => normalizeState(candidate) === n);
}
