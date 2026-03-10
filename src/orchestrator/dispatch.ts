import { normalizeState } from "../domain/normalize.js";
import { newError } from "../domain/errors.js";
import type { Issue, ServiceConfig } from "../domain/types.js";
import { verboseOpsEnabled } from "../observability/flags.js";
import { addSessionDeltas } from "../observability/metrics.js";
import type { RunAgentAttemptOptions, RunnerMode } from "../agent/runner.js";
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
  const runMode = resolveRunMode(issue, s.provider.current().cfg);
  if (verboseOpsEnabled()) {
    s.logger.info(
      "dispatch issue",
      "issue_id",
      issue.id,
      "issue_identifier",
      issue.identifier,
      "state",
      issue.state,
      "mode",
      runMode,
      "attempt",
      attemptNum
    );
  }
  const onRunnerEvent = (evt: import("../agent/protocol.js").AppServerEvent): void => {
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
  };
  void (async () => {
    if (runMode === "planning") {
      await executePlanningRun(s, runController.signal, issue, attempt, onRunnerEvent);
      return;
    }

    const options = await buildImplementationOptions(s, runController.signal, issue, attempt);
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

    await s.runner.runAgentAttempt(runController.signal, issue, options, onRunnerEvent);
  })().then(
    () => s.handleWorkerExit({ issueId: issue.id, issue, attempt: attemptNum, startedAt: now, error: null, mode: runMode }),
    (error: unknown) => s.handleWorkerExit({ issueId: issue.id, issue, attempt: attemptNum, startedAt: now, error, mode: runMode })
  );
}

function resolveRunMode(issue: Issue, cfg: ServiceConfig): RunnerMode {
  const state = normalizeState(issue.state);
  if (state === normalizeState(cfg.tracker.planningSourceState) || state === normalizeState(cfg.tracker.planningClaimState)) {
    return "planning";
  }
  return "implementation";
}

async function executePlanningRun(
  s: Scheduler,
  signal: AbortSignal,
  issue: Issue,
  attempt: number | null,
  onEvent: (evt: import("../agent/protocol.js").AppServerEvent) => void
): Promise<void> {
  const { cfg } = s.provider.current();
  if (verboseOpsEnabled()) {
    s.logger.info("planning run started", "issue_id", issue.id, "issue_identifier", issue.identifier);
  }
  const existingPlan = await s.tracker.fetchLatestPlanComment(signal, issue.id, cfg.tracker.planCommentTag);
  if (existingPlan && existingPlan.trim()) {
    if (verboseOpsEnabled()) {
      s.logger.info("planning reuse existing plan", "issue_id", issue.id, "target_state", cfg.tracker.planningTargetState);
    }
    await s.tracker.transitionIssueToState(signal, issue.id, cfg.tracker.planningTargetState);
    issue.state = cfg.tracker.planningTargetState;
    return;
  }

  if (normalizeState(issue.state) === normalizeState(cfg.tracker.planningSourceState)) {
    const liveState = await fetchCurrentState(s, signal, issue.id);
    if (normalizeState(liveState) !== normalizeState(cfg.tracker.planningSourceState)) {
      if (verboseOpsEnabled()) {
        s.logger.info("planning skipped due to state drift", "issue_id", issue.id, "state", liveState);
      }
      return;
    }
    await s.tracker.transitionIssueToState(signal, issue.id, cfg.tracker.planningClaimState);
    issue.state = cfg.tracker.planningClaimState;
    if (verboseOpsEnabled()) {
      s.logger.info("planning claim acquired", "issue_id", issue.id, "claim_state", cfg.tracker.planningClaimState);
    }
  }

  const currentState = await fetchCurrentState(s, signal, issue.id);
  if (normalizeState(currentState) !== normalizeState(cfg.tracker.planningClaimState)) {
    if (verboseOpsEnabled()) {
      s.logger.info("planning skipped after claim check", "issue_id", issue.id, "state", currentState);
    }
    return;
  }
  issue.state = currentState;

  const result = await s.runner.runAgentAttempt(
    signal,
    issue,
    {
      attempt,
      mode: "planning"
    },
    onEvent
  );
  const plan = result.plan?.trim() ?? "";
  if (!plan) {
    throw newError("planning_output_missing", `planning output missing for issue=${issue.identifier}`);
  }

  const latestPlan = await s.tracker.fetchLatestPlanComment(signal, issue.id, cfg.tracker.planCommentTag);
  if (latestPlan && latestPlan.trim()) {
    if (verboseOpsEnabled()) {
      s.logger.info("planning detected plan created by another runner", "issue_id", issue.id);
    }
    await s.tracker.transitionIssueToState(signal, issue.id, cfg.tracker.planningTargetState);
    issue.state = cfg.tracker.planningTargetState;
    return;
  }

  const commentBody = `${cfg.tracker.planCommentTag}\n\n${plan}`;
  if (verboseOpsEnabled()) {
    s.logger.info("planning post plan comment", "issue_id", issue.id, "comment_length", commentBody.length);
  }
  await s.tracker.addIssueComment(signal, issue.id, commentBody);
  await s.tracker.transitionIssueToState(signal, issue.id, cfg.tracker.planningTargetState);
  if (verboseOpsEnabled()) {
    s.logger.info("planning transition complete", "issue_id", issue.id, "target_state", cfg.tracker.planningTargetState);
  }
  issue.state = cfg.tracker.planningTargetState;
}

async function fetchCurrentState(s: Scheduler, signal: AbortSignal, issueId: string): Promise<string> {
  const stateMap = await s.tracker.fetchIssueStatesByIds(signal, [issueId]);
  const state = stateMap[issueId] ?? "";
  if (!state.trim()) {
    throw newError("issue_state_refresh_failed", `unable to refresh state for issue=${issueId}`);
  }
  return state;
}

async function buildImplementationOptions(
  s: Scheduler,
  signal: AbortSignal,
  issue: Issue,
  attempt: number | null
): Promise<RunAgentAttemptOptions> {
  const { cfg } = s.provider.current();
  if (normalizeState(issue.state) !== normalizeState(cfg.tracker.implementationState)) {
    return { attempt, mode: "implementation" };
  }
  if (verboseOpsEnabled()) {
    s.logger.info("implementation loading plan", "issue_id", issue.id, "state", issue.state);
  }
  const plan = await s.tracker.fetchLatestPlanComment(signal, issue.id, cfg.tracker.planCommentTag);
  if (!plan || !plan.trim()) {
    throw newError(
      "missing_plan_comment",
      `no tagged plan comment found for issue=${issue.identifier} in state=${cfg.tracker.implementationState}`
    );
  }
  return {
    attempt,
    mode: "implementation",
    planContext: plan
  };
}

export function containsState(states: string[], state: string): boolean {
  const n = normalizeState(state);
  return states.some((candidate) => normalizeState(candidate) === n);
}
