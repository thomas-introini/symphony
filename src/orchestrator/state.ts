import type { CodexTotals, Issue, LiveSession, RetryEntry, ServiceConfig } from "../domain/types.js";

export interface RunningEntry {
  issue: Issue;
  attempt: number | null;
  startedAt: Date;
  session: LiveSession;
  cancel: () => void;
  lastEventAt: Date;
}

export interface OrchestratorState {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  running: Record<string, RunningEntry>;
  claimed: Record<string, true>;
  retryAttempts: Record<string, RetryEntry>;
  completed: Record<string, true>;
  codexTotals: CodexTotals;
  codexRateLimits: Record<string, unknown>;
}

export function initialLiveSession(): LiveSession {
  return {
    sessionId: "",
    threadId: "",
    turnId: "",
    codexAppServerPid: "",
    lastCodexEvent: "",
    lastCodexTimestamp: null,
    lastCodexMessage: "",
    codexInputTokens: 0,
    codexOutputTokens: 0,
    codexTotalTokens: 0,
    lastReportedInput: 0,
    lastReportedOutput: 0,
    lastReportedTotal: 0,
    turnCount: 0,
    latestRateLimitPayload: {}
  };
}

export class RuntimeStore {
  state: OrchestratorState;

  constructor(cfg: ServiceConfig) {
    this.state = {
      pollIntervalMs: cfg.polling.intervalMs,
      maxConcurrentAgents: cfg.agent.maxConcurrentAgents,
      running: {},
      claimed: {},
      retryAttempts: {},
      completed: {},
      codexTotals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        secondsRunning: 0
      },
      codexRateLimits: {}
    };
  }

  snapshot(): OrchestratorState {
    const running: Record<string, RunningEntry> = {};
    for (const [k, v] of Object.entries(this.state.running)) {
      running[k] = { ...v, session: { ...v.session }, issue: { ...v.issue } };
    }
    return {
      ...this.state,
      running,
      claimed: { ...this.state.claimed },
      retryAttempts: { ...this.state.retryAttempts },
      completed: { ...this.state.completed },
      codexTotals: { ...this.state.codexTotals },
      codexRateLimits: { ...this.state.codexRateLimits }
    };
  }
}
