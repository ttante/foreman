import { select, isCancel } from "@clack/prompts";
import type {
  BuilderAdapter,
  PermissionDecision,
  PermissionHandler,
  PermissionRequest,
  TurnResult,
} from "./adapters/types.js";
import type { PermissionPolicy } from "./permissions/policy.js";
import type { Log } from "./log.js";
import { fireNotification } from "./notify.js";

/** Parsed STEP_STATUS marker from a builder's turn. */
export interface StepStatus {
  kind: "done" | "blocked" | "plan_complete" | "needs_input" | "unknown";
  summary?: string;
  next?: string;
  reason?: string;
  question?: string;
  choices?: string[];
}

/** Phrases that suggest the builder ended its turn by asking the human. */
const QUESTION_HINTS = [
  "should i",
  "would you like",
  "do you want",
  "let me know",
  "please confirm",
  "could you clarify",
  "which option",
];

/**
 * Pull the STEP_STATUS marker out of a turn's final text.
 * Format: `STEP_STATUS: <kind> | key="value" key="value"`.
 */
export function parseStepStatus(text: string): StepStatus {
  const match = text.match(
    /STEP_STATUS:\s*(done|blocked|plan_complete|needs_input)\b(.*)$/im,
  );
  if (!match) return { kind: "unknown" };
  const kind = match[1].toLowerCase() as StepStatus["kind"];
  const fields: Record<string, string> = {};
  for (const kv of match[2].matchAll(/(\w+)="([^"]*)"/g)) {
    fields[kv[1]] = kv[2];
  }
  return {
    kind,
    summary: fields.summary,
    next: fields.next,
    reason: fields.reason,
    question: fields.question,
    choices: fields.choices
      ? fields.choices.split("|").map((c) => c.trim()).filter(Boolean)
      : undefined,
  };
}

/** Heuristic: did a marker-less turn end by asking the human something? */
export function looksLikeQuestion(text: string): boolean {
  const tail = text.trim().toLowerCase().slice(-400);
  if (tail.endsWith("?")) return true;
  return QUESTION_HINTS.some((hint) => tail.includes(hint));
}

const MARKER_SPEC = `End EVERY turn with exactly one marker line as the LAST line, nothing after it:
  STEP_STATUS: done | summary="what you just did" next="the next ticket or step"
  STEP_STATUS: blocked | reason="why you cannot proceed"
  STEP_STATUS: plan_complete | summary="what you just did"
  STEP_STATUS: needs_input | question="your question for the user" choices="Option A|Option B|Option C"
Use "done" after finishing a ticket or step when more remain, "plan_complete" after
the final ticket or step, "blocked" if you cannot proceed without help, and "needs_input"
if you need the user to make a decision before continuing.`;

/** Instruction sent on the first turn of a batch. */
export function buildPrimer(n: number): string {
  return `You are being run by an automated foreman. We will work through your next ${n} tickets or implementation steps, one per turn.

Rules:
- Do exactly ONE ticket or step this turn, then stop.
- ${MARKER_SPEC}
- If a tool action is denied by foreman policy, do not retry it; report it via the blocked marker.

Implement the next ticket or step now.`;
}

/** Instruction sent on turns 2–N. */
export function buildNextStepInstruction(i: number, n: number): string {
  return `Implement the next ticket or step now (exactly one) — this is step ${i} of ${n}. Then end with the STEP_STATUS marker line.`;
}

/** Pre-flight planning turn: ask the builder to list its next N steps without implementing anything. */
export function buildPlanningTurn(n: number, ticketsContent?: string): string {
  const header = ticketsContent
    ? `Here is the project's ticket list:\n\n${ticketsContent}\n\n`
    : "";
  return `${header}Before we begin, list the next ${n} ticket(s) or step(s) you plan to implement, in order. Be specific — reference ticket IDs or titles where applicable. Do not implement anything yet; output the numbered list only. Do not emit a STEP_STATUS marker on this turn.`;
}

/** Builds the permission callback: classify, log, allow or escalate. */
export function createPermissionHandler(
  policy: PermissionPolicy,
  log: Log,
): PermissionHandler {
  return async (req: PermissionRequest): Promise<PermissionDecision> => {
    const verdict = policy.classify(req);
    log.write("permission", {
      tool: req.toolName,
      decision: verdict.decision,
      reason: verdict.reason,
    });
    if (verdict.decision === "allow") return { behavior: "allow" };

    log.write("escalation", {
      tool: req.toolName,
      reason: verdict.reason,
      input: req.input,
    });
    return {
      behavior: "deny",
      message:
        `Foreman policy: this action needs human approval (${verdict.reason}) ` +
        `and was NOT performed. Do not retry it. If this step depends on it, ` +
        `end your turn with: STEP_STATUS: blocked | reason="needs human approval: ${verdict.reason}".`,
    };
  };
}

export interface BatchResult {
  completed: number;
  requested: number;
  outcome: "all-done" | "plan-complete" | "blocked" | "needs-human";
  detail?: string;
}

/** Drives one builder through a batch of N steps via the STEP_STATUS protocol. */
export class Foreman {
  constructor(
    private readonly builder: BuilderAdapter,
    private readonly log: Log,
    private readonly notificationsEnabled = false,
  ) {}

  /**
   * Send one instruction and resolve any needs_input exchanges before returning.
   * The returned result and status always reflect the final (non-needs_input) turn.
   */
  private async doTurn(
    instruction: string,
  ): Promise<{ result: TurnResult; status: StepStatus }> {
    let result = await this.builder.sendTurn(instruction);
    let status = parseStepStatus(result.text);

    while (status.kind === "needs_input") {
      const question = status.question ?? "The builder has a question";
      const choices = status.choices?.length
        ? status.choices
        : ["Continue", "Cancel"];

      this.log.write("needs_input", { question, choices });

      if (this.notificationsEnabled) {
        fireNotification("Foreman needs your input", question);
      }

      console.log();
      const answer = await select({
        message: question,
        options: choices.map((c) => ({ value: c, label: c })),
      });
      console.log();

      if (isCancel(answer)) {
        result = { text: "", isError: false, numTurns: 0, costUsd: 0 };
        status = { kind: "blocked", reason: "user cancelled at input prompt" };
        break;
      }

      result = await this.builder.sendTurn(String(answer));
      status = parseStepStatus(result.text);
    }

    return { result, status };
  }

  /** Send a planning turn and return the builder's response text. Does not count toward steps. */
  async runPreflight(n: number, ticketsContent?: string): Promise<string> {
    const instruction = buildPlanningTurn(n, ticketsContent);
    const result = await this.builder.sendTurn(instruction);
    this.log.write("preflight", {
      ticketsProvided: ticketsContent !== undefined,
      costUsd: result.costUsd,
    });
    return result.text;
  }

  /** Send user feedback on the plan; builder responds with a revised list. Does not count toward steps. */
  async sendPreflightFeedback(feedback: string): Promise<void> {
    const result = await this.builder.sendTurn(feedback);
    this.log.write("preflight", { feedback: true, costUsd: result.costUsd });
  }

  async runBatch(n: number): Promise<BatchResult> {
    this.log.write("batch-start", { requested: n, agent: this.builder.agent });
    let completed = 0;
    let outcome: BatchResult["outcome"] = "all-done";
    let detail: string | undefined;

    for (let i = 1; i <= n; i++) {
      const instruction = i === 1 ? buildPrimer(n) : buildNextStepInstruction(i, n);
      const { result, status } = await this.doTurn(instruction);

      this.log.write("step", {
        index: i,
        statusKind: status.kind,
        summary: status.summary,
        next: status.next,
        reason: status.reason,
        costUsd: result.costUsd,
        isError: result.isError,
      });

      if (result.isError) {
        outcome = "blocked";
        detail = `builder turn errored: ${result.text.slice(0, 200)}`;
        break;
      }
      if (status.kind === "done") {
        completed++;
        continue;
      }
      if (status.kind === "plan_complete") {
        completed++;
        outcome = "plan-complete";
        detail = status.summary;
        break;
      }
      if (status.kind === "blocked") {
        outcome = "blocked";
        detail = status.reason ?? "builder reported blocked";
        break;
      }
      // No marker: treat as a blocker so we never loop blindly.
      outcome = "needs-human";
      detail = looksLikeQuestion(result.text)
        ? `builder ended with a question: ${lastLine(result.text)}`
        : "builder did not emit a STEP_STATUS marker";
      break;
    }

    this.log.write("batch-end", { completed, requested: n, outcome, detail, sessionId: this.builder.sessionId() });
    return { completed, requested: n, outcome, detail };
  }
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n");
  return (lines[lines.length - 1] ?? "").slice(0, 200);
}
