import { Command } from "commander";
import { resolve } from "node:path";
import {
  cmdInit,
  cmdUpdate,
  cmdComplete,
  cmdBlock,
  cmdUnblock,
  cmdCancel,
  cmdDiscover,
  cmdAcceptFutureWork,
  cmdReorder,
  cmdRender,
  cmdValidate,
  cmdQueue,
  cmdArchive,
} from "../tickets/commands.js";
import { importFromMarkdown } from "../tickets/importer.js";
import { formatValidationIssues } from "../tickets/validate.js";

function fail(msg: string): never {
  console.error(`foreman tickets: ${msg}`);
  process.exit(1);
}

function cwd(opts: { project?: string }): string {
  return resolve(opts.project ?? ".");
}

export function buildTicketsCommand(): Command {
  const tickets = new Command("tickets").description(
    "Manage the structured ticket tracker for a project.",
  );

  // ── init ────────────────────────────────────────────────────────────────────

  tickets
    .command("init")
    .description("Initialize .tickets/ structure in a project directory.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--app-name <name>", "application name")
    .option("--timezone <tz>", "IANA timezone (e.g. America/Chicago)", "UTC")
    .option("--queue-limit <n>", "next-queue window size", "50")
    .action((opts) => {
      const dir = cwd(opts);
      try {
        cmdInit(dir, {
          appName: opts.appName as string | undefined,
          timezone: opts.timezone as string,
          queueLimit: Number(opts.queueLimit),
        });
        console.log(`foreman tickets: initialized .tickets/ in ${dir}`);
        console.log(`foreman tickets: next — add tickets to .tickets/tickets.yaml and run \`foreman tickets render\``);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── update ──────────────────────────────────────────────────────────────────

  tickets
    .command("update <ticketId>")
    .description("Update ticket status or progress fields.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--status <status>", "new status (planned|next|in_progress|blocked|done|canceled)")
    .option("--actor <actor>", "who is making this update")
    .option("--summary <text>", "short description of the update")
    .option("--next-action <text>", "what comes next for this ticket")
    .option("--current-step <text>", "current implementation step")
    .option("--owner <name>", "ticket owner")
    .option("--validation-result <result>", "passed|failed|not_run|not_applicable")
    .option("--validation-commands <cmds>", "commands used to validate")
    .option("--evidence <text>", "evidence of correctness")
    .option("--last-error <text>", "last error message if tests failed")
    .action((ticketId: string, opts) => {
      try {
        cmdUpdate(cwd(opts), ticketId, {
          status: opts.status as string | undefined,
          actor: opts.actor as string | undefined,
          summary: opts.summary as string | undefined,
          nextAction: opts.nextAction as string | undefined,
          currentStep: opts.currentStep as string | undefined,
          owner: opts.owner as string | undefined,
          validationResult: opts.validationResult as "passed" | "failed" | "not_run" | "not_applicable" | undefined,
          validationCommands: opts.validationCommands as string | undefined,
          evidence: opts.evidence as string | undefined,
          lastError: opts.lastError as string | undefined,
        });
        console.log(`foreman tickets: updated ${ticketId}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── complete ────────────────────────────────────────────────────────────────

  tickets
    .command("complete <ticketId>")
    .description("Mark a ticket done with validation evidence.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--actor <actor>", "who completed this ticket")
    .option("--summary <text>", "completion summary")
    .option("--validation-result <result>", "passed|failed|not_run|not_applicable", "passed")
    .option("--validation-commands <cmds>", "commands used to validate")
    .option("--evidence <text>", "evidence of correctness (required unless not_applicable)")
    .option("--validation-notes <text>", "extra notes about validation")
    .action((ticketId: string, opts) => {
      try {
        cmdComplete(cwd(opts), ticketId, {
          actor: opts.actor as string | undefined,
          summary: opts.summary as string | undefined,
          validationResult: opts.validationResult as "passed" | "failed" | "not_run" | "not_applicable",
          validationCommands: opts.validationCommands as string | undefined,
          evidence: opts.evidence as string | undefined,
          validationNotes: opts.validationNotes as string | undefined,
        });
        console.log(`foreman tickets: completed ${ticketId}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── block ────────────────────────────────────────────────────────────────────

  tickets
    .command("block <ticketId>")
    .description("Mark a ticket as blocked.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--blocked-by <ids...>", "ticket IDs or labels that are blocking")
    .option("--type <type>", "blocker type (dependency|external|decision|...)")
    .option("--summary <text>", "description of the blocker")
    .option("--unblock-criteria <text>", "what needs to happen to unblock")
    .option("--actor <actor>", "who is recording this blocker")
    .action((ticketId: string, opts) => {
      try {
        cmdBlock(cwd(opts), ticketId, {
          blockedBy: opts.blockedBy as string[] | undefined,
          blockerType: opts.type as string | undefined,
          summary: opts.summary as string | undefined,
          actor: opts.actor as string | undefined,
          unblockCriteria: opts.unblockCriteria as string | undefined,
        });
        console.log(`foreman tickets: blocked ${ticketId}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── unblock ──────────────────────────────────────────────────────────────────

  tickets
    .command("unblock <ticketId>")
    .description("Remove explicit blockers from a ticket.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--summary <text>", "description of how it was unblocked")
    .option("--actor <actor>", "who resolved the blocker")
    .action((ticketId: string, opts) => {
      try {
        cmdUnblock(cwd(opts), ticketId, {
          summary: opts.summary as string | undefined,
          actor: opts.actor as string | undefined,
        });
        console.log(`foreman tickets: unblocked ${ticketId}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── cancel ───────────────────────────────────────────────────────────────────

  tickets
    .command("cancel <ticketId>")
    .description("Cancel a ticket.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .requiredOption("--summary <text>", "reason for cancellation")
    .option("--actor <actor>", "who canceled this ticket")
    .action((ticketId: string, opts) => {
      try {
        cmdCancel(cwd(opts), ticketId, {
          summary: opts.summary as string,
          actor: opts.actor as string | undefined,
        });
        console.log(`foreman tickets: canceled ${ticketId}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── discover ─────────────────────────────────────────────────────────────────

  tickets
    .command("discover")
    .description("Add newly discovered future work to the inbox.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .requiredOption("--summary <text>", "short description of the discovered work")
    .option("--source-ticket <id>", "ticket that led to this discovery")
    .option("--proposed-ticket <id>", "proposed ticket ID")
    .option("--priority-guess <p>", "P0|P1|P2|P3")
    .option("--area <area>", "product/code area")
    .option("--rationale <text>", "why this work is needed")
    .option("--needs-decision-from <who>", "who needs to decide")
    .option("--actor <actor>", "who discovered this")
    .action((opts) => {
      try {
        const id = cmdDiscover(cwd(opts), {
          summary: opts.summary as string,
          sourceTicket: opts.sourceTicket as string | undefined,
          proposedTicket: opts.proposedTicket as string | undefined,
          priorityGuess: opts.priorityGuess as string | undefined,
          area: opts.area as string | undefined,
          rationale: opts.rationale as string | undefined,
          needsDecisionFrom: opts.needsDecisionFrom as string | undefined,
          actor: opts.actor as string | undefined,
        });
        console.log(`foreman tickets: logged future work item #${id}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── accept-future-work ────────────────────────────────────────────────────────

  tickets
    .command("accept-future-work <futureWorkId>")
    .description("Promote a future-work item into tickets.yaml as a new ticket.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .requiredOption("--ticket-id <id>", "new ticket ID (e.g. T051)")
    .requiredOption("--order <n>", "canonical implementation order (e.g. 51000)")
    .option("--actor <actor>", "who accepted this item")
    .action((futureWorkId: string, opts) => {
      try {
        cmdAcceptFutureWork(cwd(opts), Number(futureWorkId), {
          ticketId: opts.ticketId as string,
          order: Number(opts.order),
          actor: opts.actor as string | undefined,
        });
        console.log(`foreman tickets: accepted future work #${futureWorkId} as ${opts.ticketId}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── reorder ──────────────────────────────────────────────────────────────────

  tickets
    .command("reorder <ticketId>")
    .description("Change the canonical implementation order of a ticket.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--after <ticketId>", "place this ticket immediately after another")
    .option("--order <n>", "set explicit order value")
    .option("--actor <actor>", "who reordered this")
    .action((ticketId: string, opts) => {
      try {
        cmdReorder(cwd(opts), ticketId, {
          afterTicketId: opts.after as string | undefined,
          order: opts.order ? Number(opts.order) : undefined,
          actor: opts.actor as string | undefined,
        });
        console.log(`foreman tickets: reordered ${ticketId}`);
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── render ───────────────────────────────────────────────────────────────────

  tickets
    .command("render")
    .description("Regenerate docs/ticket-progress.md from current structured sources.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .action((opts) => {
      try {
        cmdRender(cwd(opts));
        console.log("foreman tickets: rendered docs/ticket-progress.md");
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── validate ─────────────────────────────────────────────────────────────────

  tickets
    .command("validate")
    .description("Run all 4 validation passes. Exits 1 on error.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .action((opts) => {
      try {
        const result = cmdValidate(cwd(opts));
        if (result.issues.length === 0) {
          console.log("foreman tickets: validation passed — all 4 passes clean");
        } else {
          console.log(`foreman tickets: ${result.issues.length} issue(s) found:`);
          console.log(formatValidationIssues(result.issues));
          if (!result.clean) process.exit(1);
        }
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── queue ─────────────────────────────────────────────────────────────────────

  tickets
    .command("queue")
    .description("Print the next-N queue to stdout.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--limit <n>", "override queue limit")
    .action((opts) => {
      try {
        const rows = cmdQueue(cwd(opts), opts.limit ? Number(opts.limit) : undefined);
        if (rows.length === 0) {
          console.log("No remaining tickets.");
        } else {
          for (const r of rows) {
            console.log(`  ${r.rank}. [${r.status}] ${r.ticket}: ${r.title} (${r.priority}, blocked: ${r.blockedBy})`);
          }
        }
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── archive ───────────────────────────────────────────────────────────────────

  tickets
    .command("archive")
    .description("Update docs/ticket-archive.md and prune old completed rows.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--older-than-days <n>", "only archive tickets completed more than N days ago")
    .action((opts) => {
      try {
        cmdArchive(cwd(opts), {
          olderThanDays: opts.olderThanDays ? Number(opts.olderThanDays) : undefined,
        });
        console.log("foreman tickets: archive pass complete");
      } catch (err) {
        fail(String(err instanceof Error ? err.message : err));
      }
    });

  // ── import ────────────────────────────────────────────────────────────────────

  tickets
    .command("import")
    .description("(stub) Migrate an existing Markdown tracker.")
    .option("-p, --project <dir>", "project directory (default: cwd)")
    .option("--progress <path>", "path to existing docs/ticket-progress.md")
    .action((opts) => {
      try {
        importFromMarkdown(opts.progress as string ?? "docs/ticket-progress.md");
      } catch (err) {
        console.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }
    });

  return tickets;
}
