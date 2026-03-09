# Planned Lane Workflow Feature

Status: proposed
Owner: orchestration/tracker
Scope: GitHub Projects state flow + issue planning comment handoff

## Problem

Symphony currently treats active states as directly executable work (for example `Ready`), and the agent immediately starts implementation.

We need an intermediate planning gate:

1. If an issue is found in `Ready`, Symphony must generate an implementation plan first.
2. Symphony must post that plan as an issue comment.
3. Symphony must then move the issue to `Planned`.
4. A human later moves the issue to `Ready to implement`.
5. Symphony should only implement from `Ready to implement`, using the existing plan comment as guidance.

## Current Behavior (Codebase Analysis)

- `src/orchestrator/scheduler.ts` dispatches any issue returned by `tracker.fetchCandidateIssues(...)` if eligible.
- `src/agent/runner.ts` always renders the workflow prompt and executes coding turns immediately.
- `src/tracker/client.ts` supports state transitions (`transitionIssueToState`) but does not support commenting.
- `src/tracker/githubClient.ts` already has GraphQL mutation flow for project status updates, but no issue-comment mutation.
- `WORKFLOW.example.md` default active states currently include `Ready` and `In Progress`.

Conclusion: the current architecture has the right extension points, but needs a first-class planning stage and a tracker comment API.

## Desired Behavior

### Stage A: Planning run (`Ready` -> `Planned`)

- Scheduler sees issue in `Ready`.
- Runner executes in planning mode (not implementation mode).
- Agent output is captured as a structured implementation plan.
- Symphony posts an issue comment with the plan (tagged for machine/human discovery).
- Symphony transitions project status to `Planned`.

### Stage B: Implementation run (`Ready to implement`)

- Scheduler sees issue in `Ready to implement`.
- Symphony fetches the latest plan comment for the issue.
- Runner executes implementation mode prompt, injecting the plan content.
- Normal continuation/reconciliation behavior remains unchanged.

## Proposed Design

### 1) Config additions

Add workflow-driven state controls under tracker config:

- `tracker.planning_source_state` (default: `Ready`)
- `tracker.planning_target_state` (default: `Planned`)
- `tracker.implementation_state` (default: `Ready to implement`)
- `tracker.plan_comment_tag` (default: `<!-- symphony:implementation-plan -->`)

Rationale: keeps lanes customizable per project while preserving strong defaults.

### 2) Tracker client contract

Extend `TrackerClient` (`src/tracker/client.ts`) with:

- `addIssueComment(signal, issueId, body): Promise<void>`
- `fetchLatestPlanComment(signal, issueId, tag): Promise<string | null>`

GitHub implementation (`src/tracker/githubClient.ts` + `src/tracker/githubQueries.ts`):

- Add GraphQL mutation for `addComment(input: {subjectId, body})`.
- Add GraphQL query to fetch recent issue comments and select latest tagged plan.

### 3) Runner modes

Introduce explicit run mode in `Runner`:

- `planning`: produce implementation plan text only.
- `implementation`: execute coding guided by plan comment.

Prompt shape:

- Planning prompt requests concise, actionable implementation plan and no code changes requirement.
- Implementation prompt includes a `Plan context` section with fetched plan body.

### 4) Scheduler routing

Update dispatch path (`src/orchestrator/scheduler.ts` + `src/orchestrator/dispatch.ts`) to branch by issue state:

- If state == planning source (`Ready`):
  - run planning mode
  - post plan comment
  - transition to `Planned`
  - do not continue coding turns for this attempt
- If state == implementation state (`Ready to implement`):
  - fetch plan comment
  - run implementation mode with plan context

### 5) Idempotency and safety

- If plan comment posting fails: do not transition state.
- If transition fails after comment posted: retry with clear error reason.
- If issue already has tagged plan and is still in `Ready`: avoid duplicate plan spam (reuse latest plan unless forced).
- If no plan exists in `Ready to implement`: fail attempt with explicit error and keep issue in place for human triage.

## Testing Plan

Add unit coverage in `test/unit/` for:

1. **Config parsing/defaults**
   - new tracker fields default correctly
   - validation of non-empty planning/implementation state names
2. **Tracker GitHub adapter**
   - comment mutation request shape
   - latest tagged plan extraction
3. **Scheduler behavior**
   - `Ready` issues trigger planning path and transition to `Planned`
   - `Ready to implement` issues trigger implementation path with plan injection
4. **Failure handling**
   - comment failure blocks transition
   - missing plan in implementation stage surfaces deterministic error

## Rollout Notes

- Suggested `WORKFLOW.md` update:
  - remove `Ready` from direct implementation active set
  - include `Ready` only for planning stage, and `Ready to implement` for coding stage
- Backward compatibility:
  - if new fields are omitted, defaults preserve this new two-stage behavior
  - feature can be disabled by setting planning source/target to empty only if we explicitly support that mode

## Open Questions

- Should planning attempts be concurrency-limited separately from implementation attempts?
- Should Symphony overwrite prior plan comments when issue scope changes, or append versioned plans?
