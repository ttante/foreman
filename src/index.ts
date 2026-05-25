#!/usr/bin/env node
import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { Log } from "./log.js";
import { PermissionPolicy } from "./permissions/policy.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import { CodexAdapter } from "./adapters/codex.js";
import { Foreman, createPermissionHandler } from "./foreman.js";
import type { BuilderAdapter, BuilderEvent, EffortLevel } from "./adapters/types.js";

const program = new Command();
program
  .name("foreman")
  .description("Keep Codex / Claude Code builders moving through their step list.")
  .version("0.1.0");

program
  .command("start")
  .description("Enlist a builder and drive it through a batch of N steps.")
  .argument("<project>", "path to the project directory the builder works in")
  .requiredOption("-s, --steps <n>", "number of steps to drive")
  .option("-a, --agent <agent>", "builder agent (claude | codex)", "claude")
  .option("-m, --model <model>", "override the builder's model")
  .option("-r, --resume <sessionId>", "resume a prior builder session")
  .option("--effort <level>", "reasoning effort level (low|medium|high|xhigh)")
  .option("--fast", "fast mode — lower latency (maps to effort=low for codex)")
  .action(async (project: string, opts) => {
    const steps = Number.parseInt(opts.steps, 10);
    if (!Number.isInteger(steps) || steps < 1) {
      fail("--steps must be a positive integer");
    }
    const VALID_AGENTS = ["claude", "codex"];
    if (!VALID_AGENTS.includes(opts.agent)) {
      fail(`unknown agent "${opts.agent}" — choose: ${VALID_AGENTS.join(" | ")}`);
    }

    const VALID_EFFORT = ["low", "medium", "high", "xhigh"];
    if (opts.effort && !VALID_EFFORT.includes(opts.effort)) {
      fail(`unknown effort "${opts.effort}" — choose: ${VALID_EFFORT.join(" | ")}`);
    }

    const cwd = resolve(project);
    if (!existsSync(cwd)) fail(`project directory not found: ${cwd}`);

    const config = loadConfig(join(cwd, "foreman.yaml"));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(cwd, ".foreman", `${stamp}.jsonl`);
    const log = new Log(logPath);
    const policy = new PermissionPolicy(config.permissions, cwd);

    const adapterOpts = {
      cwd,
      model: opts.model as string | undefined,
      resumeSessionId: opts.resume as string | undefined,
      permission: createPermissionHandler(policy, log),
      effort: opts.effort as EffortLevel | undefined,
      fast: opts.fast as boolean | undefined,
    };
    const builder: BuilderAdapter =
      opts.agent === "codex"
        ? new CodexAdapter(adapterOpts)
        : new ClaudeAdapter(adapterOpts);
    const foreman = new Foreman(builder, log, config.notifications.enabled);

    const modifiers = [
      opts.model ? `model=${opts.model}` : null,
      opts.effort ? `effort=${opts.effort}` : null,
      opts.fast ? "fast" : null,
    ].filter(Boolean).join(" ");
    console.log(`foreman: driving a ${opts.agent} builder through ${steps} step(s)${modifiers ? ` [${modifiers}]` : ""}`);
    console.log(`foreman: project ${cwd}`);
    console.log(`foreman: log ${logPath}\n`);

    const viewer = printEvents(builder.events());

    try {
      const result = await foreman.runBatch(steps);
      await builder.close();
      await viewer;

      console.log(`\nforeman: ${result.completed}/${result.requested} step(s) completed`);
      console.log(`foreman: outcome — ${result.outcome}`);
      if (result.detail) console.log(`foreman: ${result.detail}`);
      const sid = builder.sessionId();
      if (sid) console.log(`foreman: resume this builder with  --resume ${sid}`);
      process.exit(result.outcome === "needs-human" ? 2 : 0);
    } catch (err) {
      await builder.close().catch(() => {});
      log.write("error", { message: String(err) });
      fail(`run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

program
  .command("status")
  .description("Summarize the most recent foreman run for a project.")
  .argument("<project>", "path to the project directory")
  .action((project: string) => {
    const dir = join(resolve(project), ".foreman");
    if (!existsSync(dir)) fail(`no foreman runs found under ${dir}`);
    const logs = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    if (logs.length === 0) fail(`no foreman runs found under ${dir}`);

    const latest = join(dir, logs[logs.length - 1]);
    const records = readFileSync(latest, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const steps = records.filter((r) => r.event === "step");
    const escalations = records.filter((r) => r.event === "escalation");
    const batchEnd = records.reverse().find((r) => r.event === "batch-end");

    console.log(`foreman: latest run ${logs[logs.length - 1]}`);
    console.log(`foreman: ${steps.length} step record(s), ${escalations.length} escalation(s)`);
    if (batchEnd) {
      console.log(`foreman: outcome — ${batchEnd.outcome} (${batchEnd.completed}/${batchEnd.requested})`);
      if (batchEnd.detail) console.log(`foreman: ${batchEnd.detail}`);
    } else {
      console.log("foreman: run is still in progress or did not finish");
    }
    for (const esc of escalations) {
      console.log(`  escalated: ${esc.tool} — ${esc.reason}`);
    }
  });

// pnpm passes its `--` separator through to the script; strip it so Commander
// sees the subcommand args correctly.
const argv = [...process.argv];
if (argv[2] === "--") argv.splice(2, 1);
program.parseAsync(argv).catch((err) => fail(String(err)));

/** Print a compact live feed of builder activity. */
async function printEvents(events: AsyncIterable<BuilderEvent>): Promise<void> {
  for await (const ev of events) {
    if (ev.kind === "tool") {
      console.log(`  → ${ev.name} ${briefInput(ev.input)}`);
    } else if (ev.kind === "turn-complete") {
      const tag = ev.result.isError ? "turn errored" : "turn complete";
      console.log(`  · ${tag} ($${ev.result.costUsd.toFixed(4)})`);
    } else if (ev.kind === "error") {
      console.log(`  ! error: ${ev.message}`);
    }
  }
}

function briefInput(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const key = o.command ?? o.file_path ?? o.path ?? o.pattern ?? "";
    return String(key).slice(0, 80);
  }
  return "";
}

function fail(message: string): never {
  console.error(`foreman: ${message}`);
  process.exit(1);
}
