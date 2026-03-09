# Symphony

Symphony is a TypeScript service that orchestrates coding-agent runs for tracker issues.

It continuously polls a tracker project, creates or reuses per-issue workspaces, runs a coding agent in those workspaces, and retries work with bounded backoff.

## What It Does

- Loads runtime config + prompt template from `WORKFLOW.md`.
- Polls GitHub Project issues in active states.
- Dispatches eligible issues with global/per-state concurrency limits.
- Runs each issue in an isolated workspace under `_symphony_workspaces` (or configured root).
- Reconciles running tasks and stops work when issue states become ineligible.
- Retries failed runs with exponential backoff.

## Current Scope

- Runtime language: TypeScript (Node ESM, `moduleResolution: NodeNext`).
- Tracker integration implemented today: **GitHub Projects**.
- Agent integration: Codex app-server protocol.
- Test framework: Vitest.

## Requirements

- Node.js `>=22`
- npm

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create local workflow config:

```bash
cp WORKFLOW.example.md WORKFLOW.md
```

3. Edit `WORKFLOW.md` with your tracker and auth values (for example GitHub token, owner/repo/project number).

4. Run in dev mode:

```bash
npm run dev
```

## Commands

Run from repository root.

- Build TypeScript:

```bash
npm run build
```

- Run dev entrypoint (tsx):

```bash
npm run dev
```

- Run built output:

```bash
npm run start
```

- Run full tests:

```bash
npm test
```

- Run a single test file:

```bash
npm run test -- test/unit/config.test.ts
```

- Run a single test case by name:

```bash
npm run test -- test/unit/config.test.ts -t "builds defaults"
```

## Repository Layout

- `src/cli/main.ts` - process entrypoint, workflow loading/watching, scheduler bootstrap.
- `src/orchestrator/` - dispatch, reconcile, retry, runtime state.
- `src/tracker/` - GitHub GraphQL client + issue normalization.
- `src/workspace/` - workspace creation, cleanup, and hooks.
- `src/workflow/` - workflow file loader + watcher.
- `src/config/` - typed config parsing and preflight validation.
- `src/agent/` - coding-agent runner and protocol integration.
- `test/unit/` - unit tests.
- `WORKFLOW.example.md` - committed workflow template.
- `WORKFLOW.md` - local runtime config (gitignored).

## Configuration Model

Symphony reads `WORKFLOW.md` front matter and prompt body:

- Front matter (`---`) contains runtime settings (`tracker`, `polling`, `workspace`, `hooks`, `agent`, `codex`).
- Markdown body is the task prompt template passed to the coding agent.

Important notes:

- `WORKFLOW.md` is ignored by git for local/operator config.
- If missing or invalid, startup/dispatch preflight can fail with explicit error codes.
- Workflow updates are watched and reloaded at runtime; invalid reloads are ignored with warnings.

## Development Notes

- No dedicated lint script exists currently.
- Treat `npm run build` as the type-checking gate.
- Coding conventions and agent guidance are documented in `AGENTS.md`.

## Testing Notes

- Unit tests live in `test/unit/` and run with Vitest.
- For feature changes, add or adjust focused tests near affected modules.
- For larger changes, run both:
  - `npm test`
  - `npm run build`

## Troubleshooting

- `missing_workflow_file`: create `WORKFLOW.md` (often by copying `WORKFLOW.example.md`).
- `missing_tracker_api_key`: ensure token is set directly or via `$ENV_VAR` in workflow config.
- GitHub API errors: verify endpoint, token scopes, owner/repo/project values.
- No issues dispatched: check `active_states`, project fields, and concurrency settings.

## Related Docs

- `AGENTS.md` - instructions for coding agents operating in this repo.
- `WORKFLOW.example.md` - template workflow file.
- `SPEC.md` - broader service specification and design notes.
