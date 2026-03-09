# AGENTS.md

Guidance for coding agents operating in this repository.

## Project Snapshot

- Language: TypeScript (ESM, NodeNext).
- Runtime: Node.js >= 22.
- Package manager: npm (lockfile: `package-lock.json`).
- Source: `src/`.
- Tests: `test/unit/` with Vitest.
- Build output: `dist/`.

## Setup

1. Install dependencies:
   - `npm install`
2. Confirm Node version:
   - `node -v` (must satisfy `>=22`)

## Build / Run / Test Commands

Use these commands from repository root (`/home/thomas/projects/symphony`).

### Core commands

- Build TypeScript:
  - `npm run build`
- Run CLI in dev mode (tsx):
  - `npm run dev`
- Run built CLI:
  - `npm run start`
- Run full test suite once:
  - `npm test`
  - Equivalent: `npm run test`

### Run a single test file (important)

- Preferred:
  - `npm run test -- test/unit/config.test.ts`
- Equivalent via vitest directly:
  - `npx vitest run test/unit/config.test.ts`

### Run a single test case (important)

- By test name pattern:
  - `npm run test -- -t "builds defaults"`
- Narrow by file + name:
  - `npm run test -- test/unit/config.test.ts -t "builds defaults"`

### Useful test/debug variants

- Watch mode while developing:
  - `npx vitest`
- Verbose reporter:
  - `npx vitest run --reporter=verbose`

## Lint / Typecheck Status

- There is currently **no dedicated lint script** in `package.json`.
- Treat `npm run build` as the required type-checking gate (`tsc -p tsconfig.json`).
- If you introduce lint tooling, wire it through `package.json` scripts and document it here.

## Repository Conventions

### Imports

- Use ESM imports with explicit `.js` extensions for local module paths.
  - Example: `import { foo } from "../util/foo.js";`
- Keep Node built-in imports first (`node:*`), then external packages, then local imports.
- Separate import groups with one blank line.
- Use `import type { ... }` for type-only imports.

### Formatting

- Indentation: 2 spaces.
- Strings: double quotes.
- Semicolons: required.
- Favor trailing commas in multiline object/array/function argument lists.
- Keep lines readable; split long function calls across lines similarly to existing code.
- Preserve existing file style rather than reformatting unrelated lines.

### Types and Type Safety

- `tsconfig.json` enforces strictness:
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
- Avoid `any`; prefer `unknown` + narrowing helpers.
- Prefer explicit return types on exported functions.
- Use narrow helper types for untrusted payloads (for example `Record<string, unknown>`).
- When reading external API payloads, validate shape defensively before use.

### Naming Conventions

- Classes/interfaces/types: `PascalCase`.
- Functions/variables/methods: `camelCase`.
- Constants: `camelCase` for module constants (existing pattern), not `SCREAMING_SNAKE_CASE`.
- Files: lower camel case or concise domain-oriented names (`githubClient.ts`, `normalizeIssue.ts`).
- Tests: `*.test.ts` under `test/unit/`.

### Error Handling

- Prefer domain-coded errors via `newError(code, message, cause?)` from `src/domain/errors.ts`.
- Use stable machine-readable error codes (for example `missing_workflow_file`).
- Throw early on invalid config or malformed remote payloads.
- In boundary layers (network, file I/O), wrap underlying failures with contextual error codes.
- In orchestrator/scheduler flows, log and continue when failure should not crash the service.

### Control Flow Patterns

- Prefer guard clauses for invalid/empty inputs.
- Keep pure helpers small and composable.
- For polling/retry logic, preserve deterministic behavior and bounded backoff.
- Do not mix unrelated refactors with behavioral fixes.

### Testing Patterns

- Use Vitest APIs: `describe`, `it`, `expect`.
- Keep tests focused on one behavior each.
- For config behavior, test defaults, coercions, env resolution, and validation failures.
- Add/adjust tests with every behavioral change.

## Working With WORKFLOW Files

- `WORKFLOW.md` is gitignored for local/operator configuration.
- `WORKFLOW.example.md` is the committed template/reference.
- If code changes affect workflow schema or behavior, update docs/tests accordingly.

## Agent Operating Rules for This Repo

- Make the smallest safe change that addresses the task.
- Stay within the requested scope; avoid drive-by rewrites.
- Update or add tests when behavior changes.
- Run relevant checks before finishing:
  - Minimum: targeted test(s).
  - Preferred for non-trivial changes: full `npm test` + `npm run build`.
- Do not commit secrets or `.env` files.

## Cursor / Copilot Rules

Checked locations:

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

Current status:

- No Cursor rule files found.
- No Copilot instruction file found.

If any of these files are added later, treat their instructions as authoritative and merge them into this guide.

## High-Confidence Change Checklist

Before handing off, verify:

1. Code builds: `npm run build`
2. Relevant tests pass (single file or `-t` targeted run)
3. Full tests pass if change is broad: `npm test`
4. New behavior has test coverage
5. Imports/types/style match local conventions
