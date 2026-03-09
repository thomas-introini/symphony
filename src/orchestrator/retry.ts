import { nowMs } from "../util/time.js";
import type { Issue } from "../domain/types.js";
import { containsState, dispatchIssue, haveSlot } from "./dispatch.js";
import type { Scheduler } from "./scheduler.js";

export function scheduleRetry(
  s: Scheduler,
  parentSignal: AbortSignal,
  issue: Issue,
  attempt: number,
  delayMs: number,
  reason: string
): void {
  const effectiveDelay = Math.max(0, delayMs);
  const timer = setTimeout(() => {
    void onRetryFired(s, parentSignal, issue.id);
  }, effectiveDelay);
  timer.unref();

  const previous = s.store.state.retryAttempts[issue.id];
  if (previous?.timerHandle) {
    clearTimeout(previous.timerHandle);
  }

  s.store.state.retryAttempts[issue.id] = {
    issueId: issue.id,
    identifier: issue.identifier,
    attempt,
    dueAtMs: nowMs() + effectiveDelay,
    timerHandle: timer,
    error: reason
  };
  s.store.state.claimed[issue.id] = true;

  s.logger.info(
    "retry scheduled",
    "issue_id",
    issue.id,
    "issue_identifier",
    issue.identifier,
    "attempt",
    attempt,
    "delay_ms",
    effectiveDelay,
    "reason",
    reason
  );
}

export async function onRetryFired(s: Scheduler, parentSignal: AbortSignal, issueId: string): Promise<void> {
  if (parentSignal.aborted) {
    return;
  }
  const { cfg } = s.provider.current();
  let candidates: Issue[];
  try {
    candidates = await s.tracker.fetchCandidateIssues(parentSignal);
  } catch (error) {
    if (parentSignal.aborted) {
      return;
    }
    s.logger.warn("retry candidate fetch failed", "issue_id", issueId, "error", String(error));
    return;
  }

  const issue = candidates.find((row) => row.id === issueId);
  if (!issue) {
    delete s.store.state.claimed[issueId];
    delete s.store.state.retryAttempts[issueId];
    return;
  }

  const retryEntry = s.store.state.retryAttempts[issueId] ?? {
    issueId,
    identifier: issue.identifier,
    attempt: 1,
    dueAtMs: 0,
    timerHandle: null,
    error: ""
  };
  if (!containsState(cfg.tracker.activeStates, issue.state)) {
    delete s.store.state.claimed[issueId];
    delete s.store.state.retryAttempts[issueId];
    return;
  }

  if (!haveSlot(s, issue, cfg)) {
    scheduleRetry(s, parentSignal, issue, retryEntry.attempt, 2000, "no available orchestrator slots");
    return;
  }

  dispatchIssue(s, parentSignal, issue, retryEntry.attempt);
}
