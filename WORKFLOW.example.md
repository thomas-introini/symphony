---
tracker:
  kind: github
  endpoint: https://api.github.com/graphql
  api_key: $YOUR_GITHUB_TOKEN
  owner: your-org
  repo: your-repo
  project_number: 1
  active_states:
    - Ready
    - Planning
    - Ready to implement
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
  status_field_name: Status
  priority_field_name: Priority
  planning_source_state: Ready
  planning_claim_state: Planning
  planning_target_state: Planned
  implementation_state: Ready to implement
  plan_comment_tag: "<!-- symphony:implementation-plan -->"

polling:
  interval_ms: 10000

workspace:
  root: ./_symphony_workspaces

hooks:
  timeout_ms: 60000
  after_create: |
    git init >/dev/null 2>&1 || true
  before_run: |
    echo "Starting run in $(pwd)"
  after_run: |
    echo "Run finished for workspace $(basename $(pwd))"
  before_remove: |
    echo "Removing workspace $(pwd)"

agent:
  max_concurrent_agents: 5
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    in progress: 3
    todo: 2

codex:
  command: codex app-server
  approval_policy: on-request
  thread_sandbox: workspace-write
  turn_sandbox_policy: workspace-write
  read_timeout_ms: 5000
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
---

# Symphony GitHub Project Workflow

You are executing work for a GitHub issue tracked through GitHub Projects.

Issue context:

- Identifier: {{issue.identifier}}
- Title: {{issue.title}}
- State: {{issue.state}}
- URL: {{issue.url}}
- Attempt: {{attempt}}
- Description: {{issue.description}}

Instructions:

1. Read the issue title/description and confirm scope before taking action.
2. If a `Plan context` section is present in the turn input, treat it as the source-of-truth implementation plan from the tagged issue comment and follow it unless repo reality requires a deviation.
3. If you deviate from the plan, explain why and keep the same intent.
4. Work only inside the current workspace directory.
5. Implement the smallest safe change that advances the issue.
6. Run relevant checks/tests for modified code.
7. If blocked, explain exactly what is blocked and what evidence you gathered.
8. End with a concise status note including what changed, any plan deviations, and next steps.
