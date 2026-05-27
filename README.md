# Foreman

Run Claude Code or Codex through a project plan without manually typing
"next step" all day.

## Start Here: Codex + Tickets

Install Foreman, initialize tickets in the project you want Foreman to manage,
ask Codex to populate the ticket file, then run Foreman against that project:

```bash
npm install -g foreman-cli

foreman doctor ../my-project
foreman tickets init --project ../my-project --app-name "My App"
foreman tickets populate --project ../my-project --agent codex --model gpt-5.5 --effort xhigh
foreman start ../my-project --agent codex --model gpt-5.5 --effort xhigh --steps 5
```

`../my-project` is the repo Foreman will work on. `tickets init` creates the
local `.tickets/` tracker, `tickets populate` asks Codex to convert existing
plans, TODOs, roadmap docs, and ticket files into Foreman's schema, and `start`
drives Codex through the next tickets one step at a time.

`--model gpt-5.5` selects the builder model. `--effort xhigh` sets the
reasoning level for agents that support it. Both options work with
`tickets populate` and `start`.

Use `--yes` with `populate` or `start` when you want to skip confirmation
prompts in a scripted workflow.

## Install Options

Global install is best for personal use:

```bash
npm install -g foreman-cli
```

Per-project install is best when a repo wants a pinned Foreman version:

```bash
npm install --save-dev foreman-cli
npx foreman doctor .
```

Requires Node.js 20 or newer.

## What Foreman Does

Foreman asks the builder for a short plan, sends one implementation step at a
time, requires a final `STEP_STATUS` marker, optionally runs QA after each step,
and writes a JSONL log under `.foreman/`.

Foreman can run in two modes:

- **Plain mode**: use any project or task file.
- **Ticket mode**: initialize `.tickets/` in the project and let Foreman keep a
  deterministic local ticket queue.

## Agent Examples

### Claude Code

```bash
foreman doctor ./my-project
foreman start ./my-project --steps 5
```

Claude is the default agent. The Claude adapter uses your existing Claude Code
credentials through the Claude Agent SDK.

### Codex

```bash
foreman doctor ./my-project
foreman start ./my-project --agent codex --model gpt-5.5 --effort xhigh --steps 5
```

The Codex adapter shells out to `codex exec`, so the `codex` CLI must be on
your `PATH`.

### With A Task File

```bash
foreman start ./my-project --steps 5 --tickets ./my-project/TICKETS.md
```

`--tickets` can point at Markdown, text, YAML, or any file you want sent to the
builder during the preflight planning turn.

## Ticket Mode Setup

Ticket mode is optional. Use it when you want the repo itself to contain the
canonical implementation order and generated agent-facing progress document.

### 1. Initialize Tickets

From anywhere:

```bash
foreman tickets init --project ./my-project --app-name "My App"
```

Or, from inside the project:

```bash
foreman tickets init --app-name "My App"
```

This creates:

```txt
.tickets/
  config.yaml
  tickets.yaml
  tracker-rules.md
  ticket-state.sqlite
  schema/
  migrations/
  backups/
docs/
  ticket-progress.md
```

### 2. Add Tickets

If the project already has tickets, plans, TODOs, roadmap docs, or a Markdown
tracker, ask a builder to convert them into Foreman's ticket format:

```bash
# Claude Code
foreman tickets populate --project ./my-project

# Codex
foreman tickets populate --project ./my-project --agent codex
foreman tickets populate --project ./my-project --agent codex --model gpt-5.5 --effort xhigh
```

`populate` tells the builder to read `.tickets/*`, `docs/ticket-progress.md`,
and existing planning files, then fill `.tickets/tickets.yaml`, render the
progress doc, and validate the result. If the existing content does not map
cleanly to Foreman's schema, the builder should ask you for guidance.

You can also edit `.tickets/tickets.yaml` manually. Ticket definitions live in
YAML; mutable status lives in SQLite and is changed by `foreman tickets`
commands.

Minimal valid example:

```yaml
tickets:
  - id: T001
    order: 1000
    title: Add health check command
    area: CLI
    priority: P1
    size: S
    risk: Low
    depends_on: []
    summary: Add a command that reports whether Foreman is configured correctly.
    acceptance:
      - The command exits 0 when required local checks pass.
      - The command prints actionable warnings for optional missing tools.
    required_tests:
      - Unit test for success output
      - Unit test for missing optional tools
    likely_files:
      - src/index.ts
      - test/*.test.ts
    rollback: null
    notes: null

  - id: T002
    order: 2000
    title: Document health check command
    area: Docs
    priority: P2
    size: XS
    risk: Low
    depends_on:
      - T001
    summary: Add README examples for the health check command.
    acceptance:
      - README shows the command in the quick start.
    required_tests:
      - Documentation review
    likely_files:
      - README.md
    rollback: Revert the README section.
    notes: null
```

Ticket fields Foreman expects:

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Stable ticket ID, unique within the file. |
| `order` | yes | Unique implementation order. Use gaps like `1000`, `2000`. |
| `title` | yes | Short human-readable title. |
| `area` | yes | Product or code area. |
| `priority` | yes | `P0`, `P1`, `P2`, or `P3`. |
| `size` | yes | `XS`, `S`, `M`, `L`, or `XL`. |
| `risk` | yes | `Low`, `Medium`, or `High`. |
| `depends_on` | yes | Array of ticket IDs. Empty array is fine. |
| `summary` | yes | Short implementation summary. |
| `acceptance` | yes | Non-empty list of completion criteria. |
| `required_tests` | yes | Non-empty list of expected validation. |
| `likely_files` | yes | Expected files or globs. Empty only when unknown. |
| `rollback` | required for Medium/High risk | Rollback or mitigation notes. |
| `notes` | optional | Extra context. |

Do not put status fields in `.tickets/tickets.yaml`. These belong in
`.tickets/ticket-state.sqlite`:

```txt
status
last_worked_at
completed_at
attempt_count
last_error
evidence
current_step
blocked_by
validation_result
```

### 3. Validate And Render

```bash
foreman tickets validate --project ./my-project
foreman tickets render --project ./my-project
foreman tickets queue --project ./my-project
```

`docs/ticket-progress.md` is generated from `.tickets/tickets.yaml` and
`.tickets/ticket-state.sqlite`. Builders should read it, but you should not
manually edit generated sections.

### 4. Run Foreman

Claude Code:

```bash
foreman start ./my-project --steps 10
```

Codex:

```bash
foreman start ./my-project --agent codex --model gpt-5.5 --effort xhigh --steps 10
```

When `.tickets/config.yaml` exists, Foreman automatically runs in ticket mode.
It marks the first eligible queue row `in_progress`, drives one step, runs QA
if enabled, and marks the ticket `done` only after QA passes.

## Common Commands

```bash
# Check environment and config
foreman doctor ./my-project

# Start fresh with Claude
foreman start ./my-project --steps 5

# Start fresh with Codex
foreman start ./my-project --agent codex --steps 5

# Start Codex with a specific model and reasoning level
foreman start ./my-project --agent codex --model gpt-5.5 --effort xhigh --steps 5

# Skip the preflight confirmation prompt
foreman start ./my-project --steps 5 --yes

# Disable per-step QA
foreman start ./my-project --steps 5 --no-qa

# Resume the latest logged session
foreman start ./my-project --steps 5 --continue

# Resume a specific session
foreman start ./my-project --steps 5 --resume <session-id>

# Show the latest run summary
foreman status ./my-project

# Show the next ticket queue
foreman tickets queue --project ./my-project
```

## Common Options

| Option | Example | Description |
| --- | --- | --- |
| `--steps <n>` | `--steps 10` | Number of implementation steps to drive. Required. |
| `--agent <agent>` | `--agent codex` | `claude` by default, or `codex`. |
| `--tickets <path>` | `--tickets TICKETS.md` | Send a task file into preflight planning. |
| `--yes` | `--yes` | Skip preflight confirmation. Useful for scripts. |
| `--no-qa` | `--no-qa` | Disable QA pass after each completed step. |
| `--continue` | `--continue` | Resume the most recent session logged in `.foreman/`. |
| `--resume <id>` | `--resume abc123` | Resume a specific Claude/Codex session. |
| `--model <model>` | `--model gpt-5.5` | Override the agent model. |
| `--effort <level>` | `--effort xhigh` | Reasoning level: `low`, `medium`, `high`, `xhigh`. |
| `--fast` | `--fast` | Lower-latency mode where supported. |

## Ticket Commands

```bash
# Initialize ticket mode
foreman tickets init --project ./my-project --app-name "My App"

# Ask Claude/Codex to populate .tickets/tickets.yaml from existing project docs
foreman tickets populate --project ./my-project
foreman tickets populate --project ./my-project --agent codex
foreman tickets populate --project ./my-project --agent codex --model gpt-5.5 --effort xhigh

# Validate ticket definitions, state, queue, and generated document
foreman tickets validate --project ./my-project

# Regenerate docs/ticket-progress.md
foreman tickets render --project ./my-project

# Print the current queue
foreman tickets queue --project ./my-project

# Update a ticket note or status
foreman tickets update T001 --project ./my-project --next-action "Add tests"

# Mark a ticket complete manually
foreman tickets complete T001 --project ./my-project --evidence "pnpm test passed"

# Block or unblock work
foreman tickets block T001 --project ./my-project --blocked-by external-api --summary "Waiting on API key"
foreman tickets unblock T001 --project ./my-project --summary "API key received"

# Capture future work discovered during implementation
foreman tickets discover --project ./my-project --summary "Add retry metrics" --rationale "Needed for operations"
```

`foreman tickets import` exists as a placeholder and is not implemented yet.

## How The Loop Works

Before implementation starts, Foreman asks the builder to list the next `N`
steps. Unless `--yes` is passed, you confirm or revise that list.

Every implementation turn must end with exactly one marker on the final
non-empty line:

```txt
STEP_STATUS: done | ticket="T001" summary="implemented health check" next="document command"
STEP_STATUS: blocked | ticket="T001" reason="missing DATABASE_URL"
STEP_STATUS: plan_complete | ticket="T001" summary="all requested work is complete"
STEP_STATUS: needs_input | question="Which storage backend?" choices="SQLite|Postgres"
```

When QA is enabled, Foreman asks the builder to review its own work:

```txt
STEP_STATUS: qa_pass | summary="tests pass and acceptance criteria are met"
STEP_STATUS: qa_fail | issues="missing test for empty config"
```

If QA fails, Foreman sends a fix instruction and reruns QA. QA turns do not
count against `--steps`.

## Permissions

Foreman's permission policy is deterministic. There is no LLM judgment in the
policy itself.

For Claude, tool requests surfaced through the SDK are classified by the
project's `foreman.yaml`:

- Tools in `permissions.escalateTools` are denied.
- File write tools are allowed only when their target stays inside the project,
  if the SDK surfaces the path to Foreman.
- Bash is denied if it contains an always-escalate substring.
- Bash is otherwise allowed only when every chained segment starts with a
  configured `allowBash` prefix.
- Unknown tools and unknown Bash commands are denied.

Codex tool calls are not currently intercepted by Foreman. Codex runs under
`codex exec --sandbox workspace-write`, so Codex safety depends on Codex's own
sandboxing.

The default config lives in [foreman.yaml](./foreman.yaml). Copy it into a
project when you need project-specific policy.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build

pnpm dev -- start ./dummy-project --steps 2
```

The package publishes a `foreman` binary from `dist/index.js`.

## Current Limitations

- One builder at a time.
- No daemon or dashboard.
- Codex tool calls are not intercepted by Foreman's permission policy.
- `foreman tickets import` is currently a stub.
- Escalated actions are denied and stop the batch; there is no approve/deny
  queue yet.
