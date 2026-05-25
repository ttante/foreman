# Foreman

Stop babysitting your coding agent. Point Foreman at a project, set a step count, walk away.

```bash
pnpm dev -- start ./my-project --steps 20
```

- ✓ Claude Code
- ✓ Codex CLI

Requires Node 20+. Desktop notifications available (macOS, Linux, WSL) — off by default, one line to enable.

---

## The problem

Your agent has a plan. Implementing it looks like:

```
you:   what's the next thing to implement?
agent: ticket #XXX
you:   implement it
(repeat all day)
...
```

Foreman does that loop for you. Specify steps, model, reasoning & speed (if applicable).

## How it works

Foreman runs a fixed loop — no LLM, no non-determinism, no surprises:

```
pre-flight: "list next N steps"  ──▶  builder lists steps (free turn, no counter)
                                            ↓
                                   you confirm the list
                                            ↓
turn 1: send primer  ──▶  builder implements step 1  ──▶  STEP_STATUS: done
turn 2: send "next"  ──▶  builder implements step 2  ──▶  STEP_STATUS: done
turn 3: send "next"  ──▶  builder has a question     ──▶  STEP_STATUS: needs_input
                              ↓
                     Foreman shows prompt in terminal (+ optional desktop notification)
                              ↓
                     you pick an answer
                              ↓
turn 4: send answer  ──▶  builder implements step 3  ──▶  STEP_STATUS: done
turn 5: send "next"  ──▶  builder: all done          ──▶  STEP_STATUS: plan_complete
```

The pre-flight turn and `needs_input` turns are free — they don't count against your `--steps` budget.

**What Foreman does with each marker:**

| Builder ends with | Foreman does |
|---|---|
| `STEP_STATUS: done` | log it, send next step |
| `STEP_STATUS: plan_complete` | log it, stop — plan finished |
| `STEP_STATUS: blocked` | stop, report reason |
| `STEP_STATUS: needs_input` | show choices in terminal, send answer, continue |
| no marker / question | stop with `needs-human` |

### The exact prompts (static strings, not generated)

**Turn 1 — primer:**
```
You are being run by an automated foreman. We will work through your next N
implementation steps, one per turn.

Rules:
- Do exactly ONE step this turn, then stop.
- End EVERY turn with exactly one marker line as the LAST line:
    STEP_STATUS: done | summary="what you just did" next="the next step"
    STEP_STATUS: blocked | reason="why you cannot proceed"
    STEP_STATUS: plan_complete | summary="what you just did"
    STEP_STATUS: needs_input | question="your question" choices="Option A|Option B|Option C"
- If a tool action is denied by foreman policy, do not retry it; report it
  via the blocked marker.

Implement the next step now.
```

**Turn 2–N:**
```
Implement the next step now (exactly one). Then end with the STEP_STATUS marker line.
```

That's it. Nothing dynamic. The builder drives the plan — Foreman just counts and parses.

### What the builder can and can't do

Every tool call the builder makes is intercepted before it executes. The policy is pure rules — no LLM judgment involved:

```
tool request
    │
    ├─ in escalateTools list?           → BLOCK  (e.g. WebFetch, WebSearch)
    ├─ Bash containing blocked pattern? → BLOCK  (e.g. git push, rm -rf, curl)
    ├─ file write outside project dir?  → BLOCK
    ├─ file op in allowTools list?      → allow
    ├─ Bash with no blocked pattern?    → allow
    └─ anything else / unrecognized?    → BLOCK  (fail-safe)
```

Blocked commands are never executed. The builder is told what was blocked and asked to emit `STEP_STATUS: blocked` — Foreman stops the batch and reports it to you.

See [Permission policy](#permission-policy) for the default blocklist and how to override it per-project with `foreman.yaml`.

---

## Usage

```bash
# Claude (default) — shows a plan preview before starting
pnpm dev -- start ./my-project --steps 20

# Ground the plan in your ticket file
pnpm dev -- start ./my-project --steps 20 --tickets ./my-project/TICKETS.md

# Skip the confirmation prompt (for scripts / CI)
pnpm dev -- start ./my-project --steps 20 --tickets ./my-project/TICKETS.md --yes

# Codex
pnpm dev -- start ./my-project --steps 20 -a codex

# Override model + reasoning effort
pnpm dev -- start ./my-project --steps 5 --model claude-opus-4-7 --effort high
pnpm dev -- start ./my-project --steps 5 -a codex --model gpt-5.3.codex --effort xhigh

# Lower latency
pnpm dev -- start ./my-project --steps 5 --fast

# Check what the last run did
pnpm dev -- status ./my-project

# Pick up where you left off (auto-detected from last log; --resume overrides)
pnpm dev -- start ./my-project --steps 10
pnpm dev -- start ./my-project --steps 10 --resume 794588ed-ec80-4e9c-9536-d023ef2c0464
```

### What you'll see

```
foreman: driving a claude builder through 20 step(s) [model=claude-opus-4-7 effort=high]
foreman: project /home/tyler/my-project
foreman: log /home/tyler/my-project/.foreman/2026-05-22T16-35-19Z.jsonl

foreman: asking builder to plan the next steps...

  · turn complete ($0.0041)

1. Add login endpoint (ticket AUTH-1)
2. Add logout endpoint (ticket AUTH-2)
...

◆ Proceed with these 20 step(s)? Yes

  → Bash pnpm test
  → Edit src/auth/login.ts
  → Write src/auth/logout.ts
  · turn complete ($0.0566)
  → Edit src/auth/middleware.ts
  → Bash pnpm test
  · turn complete ($0.0691)
  ...

foreman: 20/20 step(s) completed
foreman: outcome — all-done
foreman: resume this builder with  --resume 794588ed-ec80-4e9c-9536-d023ef2c0464
```

---

## Setup

```bash
# In this repo
pnpm install

# Run directly during development
pnpm dev -- start ./my-project --steps 10

# Or build once and use the bin
pnpm build
node dist/index.js start ./my-project --steps 10
```

---

## How the builder knows what to do

Foreman does **not** manage a ticket database. The builder already knows its plan — Foreman just tells it "do the next step" repeatedly.

At the start of each batch, Foreman sends the builder a primer that sets the rules for the session:

> *"Do exactly ONE step per turn. End every turn with a STEP_STATUS marker line..."*

After each step, the builder must end its message with one of these marker lines:

```
STEP_STATUS: done | summary="added login endpoint" next="add logout endpoint"
STEP_STATUS: blocked | reason="DATABASE_URL env var not set"
STEP_STATUS: plan_complete | summary="all auth endpoints implemented"
```

Foreman parses these to decide what to do next:

| Marker | Foreman action |
|--------|----------------|
| `done` | Log the step, send "next step" |
| `plan_complete` | Log the step, finish the batch |
| `blocked` | Stop the batch, report the reason |
| *(no marker)* | Treat as blocked — logs "builder did not emit a STEP_STATUS marker" |

If you're asking the builder for its plan before running Foreman, ask it to **use that exact format** for its steps, or tell it at the start of a session:

> *"When I say 'go', implement your steps one at a time and end each turn with `STEP_STATUS: done/blocked/plan_complete`."*

---

## Permission policy

Foreman intercepts every tool request and decides: **allow automatically** or **block**.

### What gets auto-allowed
- All file reads (anywhere)
- All file writes and edits (auto-approved — the worker can freely edit files in the project)
- Any Bash command that doesn't contain a blocked pattern

### What gets blocked
Any Bash command that contains a substring from the `escalateBash` list — checked against the **full command string**, including chained commands. If `git push` is in the list and the worker runs `npm run build && git push`, it's blocked.

Non-Bash tools in `escalateTools` (like `WebFetch`) are always blocked regardless of input.

When something is blocked, the worker is told to emit `STEP_STATUS: blocked` with a reason. Foreman stops the batch and reports it.

### `foreman.yaml` — what it is and where it comes from

**`foreman.yaml` is a config file specific to this project — not a standard or third-party thing.** We created it. There's nothing magic about the name; it's just what Foreman looks for.

The defaults are baked into `src/config.ts`. The `foreman.yaml` in the root of this repo documents those defaults and serves as a copy-paste template. You don't need one at all unless you want to override something.

To use it: drop a `foreman.yaml` into whichever project you're running Foreman against. Foreman reads it from the **project directory** (the path you pass to `start`), so each project can have its own policy. If no file is found, the built-in defaults apply.

### Full example `foreman.yaml`

This is the complete file with every field documented. Copy it into a project and edit from there:

```yaml
permissions:

  # Bash: a command is BLOCKED if its full text contains any of these substrings.
  # Checked against the entire command string including chained parts (&&, ||, ;, |).
  # To unblock something (e.g. curl for a project that needs it), remove it from this list.
  escalateBash:
    - rm -rf
    - rm -r
    - sudo
    - git push
    - git reset --hard
    - git clean
    - curl
    - wget
    - ssh
    - scp
    - docker
    - kubectl
    - chmod 777

  # Non-Bash tools that are ALWAYS blocked (network access tools).
  escalateTools:
    - WebFetch
    - WebSearch

  # Non-Bash tools that are always allowed.
  # File writes/edits in this list are further restricted to inside the project dir.
  allowTools:
    - Read
    - Glob
    - Grep
    - Edit
    - Write
    - MultiEdit
    - NotebookEdit
    - TodoWrite

notifications:
  # Fire a desktop notification when the builder needs your input.
  # macOS: built-in (osascript). Linux: notify-send. WSL: Windows toast.
  # Default: false.
  enabled: false
```

**Common adjustments:**

| Scenario | Change |
|----------|--------|
| Project needs to make HTTP requests | Remove `curl` and `wget` from `escalateBash` |
| Want to prevent any git commits | Add `git commit` to `escalateBash` |
| Project uses Docker in its test suite | Remove `docker` from `escalateBash` |
| Lock down to read-only (no file writes) | Remove `Edit`, `Write`, `MultiEdit` from `allowTools` |

---

## CLI reference

### `foreman start`

```
foreman start <project> --steps <n> [options]

Arguments:
  project               path to the project the builder works in

Options:
  -s, --steps <n>             how many steps to drive (required)
  -a, --agent <agent>         builder agent: claude (default) | codex
  -m, --model <model>         override the model
                                claude: claude-opus-4-7, claude-sonnet-4-6, …
                                codex:  gpt-5.4, gpt-5.3.codex, gpt-5.4-mini, …
      --effort <level>        reasoning effort: low | medium | high | xhigh
                                claude maps this to its native effort levels
                                codex maps this to model_reasoning_effort config
      --fast                  fast mode — lower latency
                                claude: enables Claude Code's --fast flag
                                codex:  sets model_reasoning_effort=low (unless
                                        --effort is also given)
  -t, --tickets <path>        path to ticket/task file (.md, .txt, .yaml, …)
                                content is sent to the builder during the pre-flight
                                planning turn so it can ground its plan in your tickets
  -y, --yes                   skip the pre-flight confirmation prompt
  -r, --resume <id>           resume a specific prior session by ID
                                omit to auto-resume from the most recent run
```

**Exit codes:**
- `0` — all steps completed or plan finished cleanly
- `1` — error (bad args, no project dir, SDK failure)
- `2` — batch ended with `needs-human` (builder asked a question instead of emitting a marker)

### `foreman status`

```
foreman status <project>
```

Reads the most recent `.foreman/*.jsonl` log in the project and prints a summary:

```
foreman: latest run 2026-05-22T16-35-19Z.jsonl
foreman: 20 step record(s), 0 escalation(s)
foreman: outcome — all-done (20/20)
```

---

## Session resume

Every run prints a session ID at the end:

```
foreman: resume this builder with  --resume 794588ed-ec80-4e9c-9536-d023ef2c0464
```

Pass that ID to continue in the same context — the builder remembers what it's done:

```bash
foreman start ./my-project --steps 20 --resume 794588ed-ec80-4e9c-9536-d023ef2c0464
```

For Claude, sessions are stored in `~/.claude/projects/`. For Codex, sessions are stored in `~/.codex/`. Both persist until you clear them.

---

## Logs

Every run writes a JSONL log to `<project>/.foreman/<timestamp>.jsonl`. Each line is a JSON record:

| `event` | When it fires |
|---------|---------------|
| `batch-start` | Run begins |
| `step` | Each step completes (includes `statusKind`, `summary`, `costUsd`) |
| `permission` | Every tool request decided (includes `tool`, `decision`, `reason`) |
| `escalation` | A tool request was blocked (includes `tool`, `reason`, `input`) |
| `needs_input` | Builder asked a question (includes `question`, `choices`) |
| `batch-end` | Run ends (includes `completed`, `requested`, `outcome`, `detail`) |
| `error` | Something went wrong |

Quick read with `jq`:

```bash
# All step summaries from the last run
cat .foreman/*.jsonl | jq 'select(.event=="step") | {i: .index, status: .statusKind, s: .summary}'

# Any escalations
cat .foreman/*.jsonl | jq 'select(.event=="escalation")'

# Total API cost
cat .foreman/*.jsonl | jq 'select(.event=="step") | .costUsd' | paste -sd+ | bc
```

---

## Project layout

```
src/
  index.ts              # CLI (start / status)
  foreman.ts            # step-loop controller, STEP_STATUS parser, permission handler
  config.ts             # load + merge foreman.yaml
  log.ts                # append-only JSONL logger
  adapters/
    types.ts            # BuilderAdapter interface + EffortLevel type
    claude.ts           # Claude Agent SDK implementation
    codex.ts            # Codex CLI subprocess implementation
  permissions/
    policy.ts           # rules-based allow/escalate classifier
  util/
    asyncQueue.ts       # async iterable queue (SDK streaming input)
test/
  policy.test.ts        # permission policy + STEP_STATUS parsing unit tests
  codex.test.ts         # CodexAdapter arg construction + JSONL parsing unit tests
foreman.yaml            # default permission config (copy to your project to override)
```

---

## What's coming

- **Git worktree isolation** — each builder gets its own branch, no collisions
- **Multi-builder** — run several projects in parallel, one foreman watching all
- **Escalation UX** — `foreman approve <id>` / `foreman deny <id>` to respond to blocked actions without stopping the run
- **Resume after crash** — SQLite state so a killed foreman picks up where it left off
- **Dashboard** — live TUI or web view showing all builders' progress

---

## Limitations

- **One builder at a time** — multi-builder is not yet supported
- **No daemon** — `start` runs in the foreground; stop with Ctrl-C
- **Codex tool calls are not intercepted** — the permission policy applies to Claude only; Codex manages its own sandboxing via `--sandbox workspace-write`
- **File writes outside the project directory are not blocked for Claude** — current `acceptEdits` mode auto-approves all file ops
- **Escalated Bash commands block the step** — there's no interactive approve/deny yet; the builder reports `blocked` and you resume manually
