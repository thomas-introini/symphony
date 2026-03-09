# Symphony TypeScript GitHub Tracker Implementation Plan

Status: planned
Scope: Core architecture from Section 18.1, with tracker integration adapted to GitHub Issues + GitHub Projects
Runtime: TypeScript (Node.js 22+)

## 1) Goals for This Phase

Deliver a working Symphony service that:

- Loads `WORKFLOW.md` and applies typed config with defaults and env indirection.
- Polls GitHub Issues/Projects for active issues and dispatches bounded concurrent agent runs.
- Maintains single-authority orchestrator runtime state in memory.
- Creates/reuses per-issue workspaces with safety invariants and hook lifecycle.
- Runs coding-agent sessions through Codex app-server protocol over stdio.
- Reconciles active sessions, handles retries/backoff, and supports restart recovery without DB.
- Emits operator-visible structured logs with issue/session context and runtime metrics.

Out of scope for this phase:

- Optional HTTP server extension (`server.port`, `/api/v1/*`, dashboard).
- Optional `linear_graphql` client-side tool extension.
- Persistent retry/session state across restarts.

## 2) Proposed Project Structure

```text
src/
  cli/
    main.ts
  domain/
    types.ts
    errors.ts
    normalize.ts
  workflow/
    loader.ts
    watcher.ts
    template.ts
  config/
    schema.ts
    resolve.ts
    getters.ts
    validate.ts
  tracker/
    client.ts
    githubClient.ts
    githubQueries.ts
    normalizeIssue.ts
  workspace/
    manager.ts
    hooks.ts
    safety.ts
  agent/
    appServerClient.ts
    protocol.ts
    eventExtract.ts
    runner.ts
  orchestrator/
    state.ts
    scheduler.ts
    dispatch.ts
    reconcile.ts
    retry.ts
  observability/
    logger.ts
    metrics.ts
  ui/
    tui.ts
    model.ts
    views.ts
  util/
    time.ts
    paths.ts
    async.ts
    process.ts
test/
  unit/
  integration/
```

## 3) Core Domain Model (Spec Section 4)

Implement typed entities first to keep all components aligned:

- `Issue` normalized model with all required fields.
- `WorkflowDefinition` with `{ config, promptTemplate }`.
- Typed `ServiceConfig` with defaults, coercions, and runtime getters.
- `Workspace` (`path`, `workspaceKey`, `createdNow`).
- `RunAttempt` logical metadata.
- `LiveSession` metadata (session/thread/turn IDs, token counters, last event/time/message, turn count).
- `RetryEntry` (`issueId`, `identifier`, `attempt`, `dueAtMs`, `timerHandle`, `error`).
- `OrchestratorState` with `running`, `claimed`, `retryAttempts`, `completed`, `codexTotals`, and `codexRateLimits`.

Normalization helpers:

- State normalization: `state.trim().toLowerCase()`.
- Workspace key sanitization: replace `[^A-Za-z0-9._-]` with `_`.
- Session ID composition: `<thread_id>-<turn_id>`.

## 4) Workflow Loader + Template Engine (Spec Sections 5, 12)

### 4.1 Loader

- Resolve workflow path precedence:
  1. explicit CLI/runtime path
  2. default `./WORKFLOW.md`
- Parse front matter when file starts with `---`.
- Enforce front matter root object/map.
- Trim prompt body and keep empty-string behavior explicit.
- Return typed errors:
  - `missing_workflow_file`
  - `workflow_parse_error`
  - `workflow_front_matter_not_a_map`

### 4.2 Template

- Use strict template rendering semantics (Liquid-compatible engine).
- Fail on unknown variables and unknown filters.
- Input context: `{ issue, attempt }`.
- If prompt body is empty, use minimal fallback prompt.
- Typed rendering errors:
  - `template_parse_error`
  - `template_render_error`

### 4.3 Dynamic Reload

- Watch workflow file for changes and re-read/re-apply.
- If reload invalid, keep last-known-good effective config/prompt and log operator-visible error.
- Re-validate defensively on dispatch ticks in case watch events are missed.

## 5) Config Layer (Spec Section 6)

Build typed getters and validation:

- Coerce integer fields from numeric strings where allowed.
- Resolve `$VAR` indirection (empty resolved value treated as missing where required).
- Expand `~` and env vars for path fields only.
- Preserve command strings (do not path-expand arbitrary shell commands).
- Apply defaults for all core keys:
  - tracker endpoint, active/terminal states
  - polling interval
  - workspace root
  - hook timeout
  - agent concurrency/backoff/max_turns
  - codex command/timeouts
- Normalize `max_concurrent_agents_by_state` keys and ignore invalid values.

Dispatch preflight validation:

- workflow load/parse succeeds
- `tracker.kind` present and supported (`github`)
- tracker api key present after `$` resolution
- `tracker.repo` present for github
- `tracker.project_number` present for github projects mode
- `codex.command` non-empty

Behavior:

- Startup validation failure => fail startup.
- Per-tick validation failure => skip dispatch, continue reconciliation.

## 6) GitHub Issue Tracker Client (Adapter)

Implement required adapter ops:

- `fetchCandidateIssues(signal)`
- `fetchIssuesByStates(signal, stateNames)`
- `fetchIssueStatesByIds(signal, issueIds)`

GitHub requirements:

- GraphQL endpoint default `https://api.github.com/graphql`.
- Authorization header with API key.
- Candidate selection uses GitHub Projects (ProjectV2) status field + configured repository scope.
- Pagination for candidates (page size default 50).
- Network timeout 30s.
- State refresh query by issue node IDs.

Config contract for `tracker.kind: github`:

- `tracker.kind`: `github`
- `tracker.api_key`: token or `$VAR`
- `tracker.owner`: organization/user owner name
- `tracker.repo`: repository name
- `tracker.project_number`: project number for ProjectV2
- `tracker.active_states`: list or comma-separated string (default `Todo`, `In Progress`)
- `tracker.terminal_states`: list or comma-separated string (default `Done`, `Closed`, `Cancelled`, `Canceled`, `Duplicate`)
- `tracker.status_field_name`: optional, default `Status`
- `tracker.priority_field_name`: optional, default `Priority`

Normalization:

- Lowercase labels.
- `blockedBy` from GitHub issue relations when available (or empty list when unavailable).
- Integer priority only; else `null`.
- Parse `createdAt` / `updatedAt` timestamps.

Error mapping:

- `unsupported_tracker_kind`
- `missing_tracker_api_key`
- `missing_tracker_owner`
- `missing_tracker_repo`
- `missing_tracker_project_number`
- `github_api_request`
- `github_api_status`
- `github_graphql_errors`
- `github_unknown_payload`
- `github_missing_end_cursor`

## 7) Workspace Manager + Hooks + Safety (Spec Section 9)

Workspace behavior:

- Compute deterministic path `<workspace.root>/<sanitized_identifier>`.
- Ensure directory exists and track `createdNow`.
- Reuse existing directories.
- Handle pre-existing non-directory safely (fail with typed error policy).

Hook lifecycle:

- `after_create` on first creation only (fatal on fail/timeout).
- `before_run` before each attempt (fatal on fail/timeout).
- `after_run` after each attempt (log and ignore fail/timeout).
- `before_remove` before workspace delete (log and ignore fail/timeout).
- Shared timeout from `hooks.timeout_ms` with default/fallback behavior.

Safety invariants:

- Validate workspace path is under workspace root (absolute, normalized check).
- Validate agent `cwd` equals workspace path before launch.
- Enforce sanitized workspace keys.

Startup cleanup:

- Fetch terminal-state issues and remove corresponding workspaces.
- Log warning and continue if terminal fetch fails.

## 8) Codex App-Server Client (Spec Section 10)

Launch + protocol:

- Spawn `bash -lc <codex.command>` in workspace cwd using `child_process.spawn`.
- Keep stdout/stderr separate; parse protocol JSON from stdout lines only.
- Buffer partial stdout lines until newline (line-based parser over stream chunks).
- Enforce max line size safety.

Handshake sequence:

1. `initialize`
2. `initialized`
3. `thread/start`
4. `turn/start`

Session extraction:

- Parse `thread_id` and `turn_id` from nested results.
- Emit `session_started` and computed `session_id`.

Turn processing:

- Completion events: `turn/completed`, `turn/failed`, `turn/cancelled`, timeout, subprocess exit.
- Support continuation turns on same `thread_id` up to `agent.max_turns`.

Policy posture for this implementation (documented):

- High-trust default behavior for approvals (auto-approve supported approval requests).
- Treat user-input-required as hard failure (`turn_input_required`).
- Unsupported tool calls return failure response and continue.

Timeouts:

- `read_timeout_ms`
- `turn_timeout_ms`
- stall handled by orchestrator using `stall_timeout_ms`

Error mapping:

- `codex_not_found`, `invalid_workspace_cwd`, `response_timeout`, `turn_timeout`,
  `port_exit`, `response_error`, `turn_failed`, `turn_cancelled`, `turn_input_required`

## 9) Agent Runner (Spec 10.7 + 16.5)

`runAgentAttempt(signal, issue, attempt)` flow:

1. create/reuse workspace
2. run `before_run`
3. start app-server session
4. render prompt and run first turn
5. on successful turn, refresh issue state from tracker
6. continue turns on same thread while issue remains active and `turnCount < maxTurns`
7. stop app-server and run `after_run` best-effort
8. return success/failure to orchestrator

Prompt semantics:

- first turn uses full rendered workflow task prompt
- continuation turns use continuation guidance (not full prompt resend)

## 10) Orchestrator (Spec Sections 7, 8, 16)

Runtime state authority:

- Single orchestrator owner mutates `running`, `claimed`, retries, and totals.

Concurrency model:

- Use async worker tasks per attempt, with orchestrator mutations serialized through a single event queue.
- Use `AbortController` / `AbortSignal` for cancellation and timeout propagation.
- Use `setInterval` for polling and `setTimeout` for retry scheduling.

Poll loop:

1. reconcile running issues (stall + tracker state refresh)
2. preflight validate config
3. fetch candidate issues
4. sort (priority asc, createdAt oldest, identifier tie-break)
5. dispatch while slots remain
6. notify observers/log state changes
7. schedule next tick using current effective interval

Eligibility rules:

- required fields present
- state active and not terminal
- not in `running` or `claimed`
- global and per-state slots available
- blocker rule for `Todo` (skip if any blocker non-terminal)

Dispatch and claims:

- claim before/with worker start to avoid duplicate dispatch
- store running entry metadata and remove retry entry for issue

Worker exit handling:

- normal exit => continuation retry after 1000ms with attempt 1
- abnormal exit => exponential retry `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`
- update runtime totals on exit

Retry timer behavior:

- re-fetch active candidates
- issue missing => release claim
- issue eligible + slots => dispatch with retry attempt
- no slots => requeue retry with explicit reason
- issue not active => release claim

Reconciliation details:

- stall detection on inactivity since last event (or startedAt)
- if terminal state => stop run and cleanup workspace
- if active => refresh running issue snapshot
- if non-active non-terminal => stop run without cleanup
- if refresh fails => keep workers running and retry next tick

## 11) Observability + Metrics (Spec Section 13)

Structured logging:

- Include `issue_id`, `issue_identifier` on issue-scoped logs.
- Include `session_id` on session lifecycle logs.
- Stable key=value style, concise reasons, no large payload dumps.

Metrics/accounting:

- Track aggregate input/output/total tokens.
- Prefer absolute token totals from known event shapes; compute deltas from last reported totals.
- Track latest rate-limit payload.
- Track runtime seconds by adding ended-session durations and including live elapsed for active runs when needed.

## 12) Near-Term Operator TUI

Introduce an optional terminal UI in the near future, designed to be simple and elegant, while keeping
core orchestration correctness independent from the UI.

Principles:

- TUI is an observability/status surface, not a source of orchestration truth.
- Orchestrator remains headless-capable and fully operable via logs/CLI.
- UI can be enabled by flag (for example `--tui`) without changing core behavior.

Node ecosystem direction:

- Prefer `@inkjs/ui` + `ink` or `blessed` + `neo-blessed` based on team preference.
- Keep rendering layer isolated behind a read-only snapshot API.

Initial TUI scope:

- Running sessions table (`issue`, `state`, `session_id`, `turn_count`, last event).
- Retry queue table (attempt, due time, last error).
- Aggregate token/runtime panel.
- Latest rate-limit panel and recent orchestrator warnings/errors.

Delivery posture:

- Build this as Milestone 6 after core conformance.
- Keep the TUI package decoupled from orchestrator internals via a snapshot interface.

## 13) CLI + Host Lifecycle (Spec Section 17.7)

CLI behavior:

- Accept optional positional workflow path.
- Default to `./WORKFLOW.md`.
- Error on missing explicit/default workflow file.
- Start orchestrator and keep process alive until shutdown.
- Clean shutdown path with success exit.
- Non-zero exit on startup failure or abnormal host exit.

## 14) Test Strategy (Core Conformance)

Prioritize deterministic tests for Sections 17.1-17.7:

- Workflow parsing, defaults, env/path resolution, strict template errors, reload fallback.
- Workspace path safety invariants, hooks timing and failure semantics.
- GitHub pagination/filtering/query shape and normalization.
- Dispatch ordering, eligibility, blocker rule, concurrency limits.
- Retry scheduling/backoff cap and continuation retry behavior.
- Reconciliation stop/cleanup behavior and stall handling.
- Protocol handshake ordering, line buffering, timeout behavior, stderr handling, and event mapping.
- CLI path semantics and startup failure exit codes.

Test implementation notes:

- Use fake tracker + fake app-server process fixtures for deterministic orchestrator tests.
- Use temporary directories for workspace tests.
- Use fake timers where needed for poll/retry/stall deterministic timing.
- Use `msw` or `nock` for tracker client integration-style tests.
- Run `pnpm test` (or equivalent) in CI and local verification.

## 15) Incremental Delivery Milestones

Milestone 1: Foundations

- Domain types, error taxonomy, loader/template, config layer, logger.

Milestone 2: Integrations

- GitHub read client + normalization; workspace manager + hooks + safety.

Milestone 3: Agent execution

- Codex app-server client and agent runner with turn continuation.

Milestone 4: Orchestration

- Poll loop, dispatch, reconciliation, retries, runtime accounting.

Milestone 5: Productization

- CLI lifecycle and conformance-focused test suite.

Milestone 6: Optional TUI

- Terminal status UI with live snapshot rendering and keyboard navigation.

## 16) Risks and Mitigations

- Protocol shape drift across Codex versions:
  - Keep parser lenient for equivalent payloads; isolate extraction logic.
- GitHub GraphQL schema drift:
  - Isolate queries and normalization, with tests around expected shapes.
- Hook scripts hanging or failing:
  - Strict timeout enforcement and clear logging.
- File-watch unreliability:
  - Defensive reload/validation before dispatch.
- UI complexity creeping into orchestrator:
  - Enforce snapshot-only interface from orchestrator to TUI.

## 17) Definition of Done for This Phase

Done when:

- All Section 18.1 required capabilities are implemented.
- Core conformance tests for Sections 17.1-17.7 pass.
- Service starts with a valid workflow and runs polling/reconciliation safely.
- Invalid workflow/config cases fail safely and remain operator-visible.
- Workspace safety invariants are enforced at runtime before agent launch.

Note:

- This plan keeps Symphony's core orchestration and safety model, swaps runtime implementation to TypeScript,
  and keeps the tracker adapter focused on GitHub Issues + GitHub Projects.
- A terminal TUI is a near-term, optional enhancement for operator visibility.
