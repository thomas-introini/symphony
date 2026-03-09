import os from "node:os";
import path from "node:path";

import type { ServiceConfig, WorkflowDefinition } from "../domain/types.js";
import { clampPositive, coalesce, getInt, getStateConcurrency, getString, getStringList } from "./getters.js";
import { expandPathValue, resolveEnvToken } from "./resolve.js";

const defaultTrackerEndpoint = "https://api.github.com/graphql";
const defaultPollingIntervalMs = 30000;
const defaultHookTimeoutMs = 60000;
const defaultMaxConcurrentAgents = 10;
const defaultMaxTurns = 20;
const defaultMaxRetryBackoffMs = 300000;
const defaultCodexCommand = "codex app-server";
const defaultTurnTimeoutMs = 3600000;
const defaultReadTimeoutMs = 5000;
const defaultStallTimeoutMs = 300000;
const defaultProjectStatusField = "Status";
const defaultProjectPriorityField = "Priority";
const defaultPlanningSourceState = "Ready";
const defaultPlanningTargetState = "Planned";
const defaultImplementationState = "Ready to implement";
const defaultPlanCommentTag = "<!-- symphony:implementation-plan -->";

const defaultActiveStates = ["Todo", "In Progress"];
const defaultTerminalStates = ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"];

export function buildServiceConfig(def: WorkflowDefinition): ServiceConfig {
  const root = def.config;
  const workspaceRoot = path.join(os.tmpdir(), "symphony_workspaces");

  const cfg: ServiceConfig = {
    tracker: {
      kind: getString(root, "tracker", "kind"),
      endpoint: coalesce(getString(root, "tracker", "endpoint"), defaultTrackerEndpoint),
      apiKey: resolveEnvToken(getString(root, "tracker", "api_key")),
      owner: getString(root, "tracker", "owner"),
      repo: getString(root, "tracker", "repo"),
      projectNumber: getInt(root, "tracker", "project_number", 0),
      activeStates: getStringList(root, "tracker", "active_states", defaultActiveStates),
      terminalStates: getStringList(root, "tracker", "terminal_states", defaultTerminalStates),
      statusFieldName: coalesce(getString(root, "tracker", "status_field_name"), defaultProjectStatusField),
      priorityFieldName: coalesce(getString(root, "tracker", "priority_field_name"), defaultProjectPriorityField),
      planningSourceState: coalesce(getString(root, "tracker", "planning_source_state"), defaultPlanningSourceState),
      planningTargetState: coalesce(getString(root, "tracker", "planning_target_state"), defaultPlanningTargetState),
      implementationState: coalesce(getString(root, "tracker", "implementation_state"), defaultImplementationState),
      planCommentTag: coalesce(getString(root, "tracker", "plan_comment_tag"), defaultPlanCommentTag)
    },
    polling: {
      intervalMs: getInt(root, "polling", "interval_ms", defaultPollingIntervalMs)
    },
    workspace: {
      root: expandPathValue(coalesce(resolveEnvToken(getString(root, "workspace", "root")), workspaceRoot))
    },
    hooks: {
      afterCreate: getString(root, "hooks", "after_create"),
      beforeRun: getString(root, "hooks", "before_run"),
      afterRun: getString(root, "hooks", "after_run"),
      beforeRemove: getString(root, "hooks", "before_remove"),
      timeoutMs: clampPositive(getInt(root, "hooks", "timeout_ms", defaultHookTimeoutMs), defaultHookTimeoutMs)
    },
    agent: {
      maxConcurrentAgents: clampPositive(
        getInt(root, "agent", "max_concurrent_agents", defaultMaxConcurrentAgents),
        defaultMaxConcurrentAgents
      ),
      maxTurns: clampPositive(getInt(root, "agent", "max_turns", defaultMaxTurns), defaultMaxTurns),
      maxRetryBackoffMs: clampPositive(
        getInt(root, "agent", "max_retry_backoff_ms", defaultMaxRetryBackoffMs),
        defaultMaxRetryBackoffMs
      ),
      maxConcurrentAgentsByState: getStateConcurrency(root)
    },
    codex: {
      command: coalesce(getString(root, "codex", "command"), defaultCodexCommand),
      approvalPolicy: getString(root, "codex", "approval_policy"),
      threadSandbox: getString(root, "codex", "thread_sandbox"),
      turnSandboxPolicy: getString(root, "codex", "turn_sandbox_policy"),
      turnTimeoutMs: clampPositive(getInt(root, "codex", "turn_timeout_ms", defaultTurnTimeoutMs), defaultTurnTimeoutMs),
      readTimeoutMs: clampPositive(getInt(root, "codex", "read_timeout_ms", defaultReadTimeoutMs), defaultReadTimeoutMs),
      stallTimeoutMs: getInt(root, "codex", "stall_timeout_ms", defaultStallTimeoutMs)
    }
  };

  if (cfg.polling.intervalMs <= 0) {
    cfg.polling.intervalMs = defaultPollingIntervalMs;
  }
  return cfg;
}
