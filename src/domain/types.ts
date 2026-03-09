export interface BlockerRef {
  id: string;
  identifier: string;
  state: string;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  priority: number | null;
  state: string;
  branchName: string;
  url: string;
  labels: string[];
  blockedBy: BlockerRef[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  promptTemplate: string;
  path: string;
  loadedAt: Date;
}

export interface TrackerConfig {
  kind: string;
  endpoint: string;
  apiKey: string;
  owner: string;
  repo: string;
  projectNumber: number;
  activeStates: string[];
  terminalStates: string[];
  statusFieldName: string;
  priorityFieldName: string;
}

export interface PollingConfig {
  intervalMs: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  afterCreate: string;
  beforeRun: string;
  afterRun: string;
  beforeRemove: string;
  timeoutMs: number;
}

export interface AgentConfig {
  maxConcurrentAgents: number;
  maxTurns: number;
  maxRetryBackoffMs: number;
  maxConcurrentAgentsByState: Record<string, number>;
}

export interface CodexConfig {
  command: string;
  approvalPolicy: string;
  threadSandbox: string;
  turnSandboxPolicy: string;
  turnTimeoutMs: number;
  readTimeoutMs: number;
  stallTimeoutMs: number;
}

export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  codex: CodexConfig;
}

export interface Workspace {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
}

export interface RunAttempt {
  issueId: string;
  issueIdentifier: string;
  attempt: number | null;
  workspacePath: string;
  startedAt: Date;
  status: string;
  error: string;
}

export interface LiveSession {
  sessionId: string;
  threadId: string;
  turnId: string;
  codexAppServerPid: string;
  lastCodexEvent: string;
  lastCodexTimestamp: Date | null;
  lastCodexMessage: string;
  codexInputTokens: number;
  codexOutputTokens: number;
  codexTotalTokens: number;
  lastReportedInput: number;
  lastReportedOutput: number;
  lastReportedTotal: number;
  turnCount: number;
  latestRateLimitPayload: Record<string, unknown>;
}

export interface RetryEntry {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  timerHandle: NodeJS.Timeout | null;
  error: string;
}

export interface CodexTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}
