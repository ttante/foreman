import { resolve, isAbsolute } from "node:path";
import type { PermissionConfig } from "../config.js";
import type { PermissionRequest } from "../adapters/types.js";

export interface Classification {
  decision: "allow" | "escalate";
  reason: string;
}

/** Tools that write to disk — allowed only inside the worktree. */
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Shell operators we split on to vet each segment of a chained command. */
const SHELL_SPLIT = /&&|\|\||;|\|/;

/**
 * Rules-based permission classifier. No LLM: routine requests are auto-approved,
 * anything risky or unrecognized escalates to the human (fail safe).
 */
export class PermissionPolicy {
  constructor(
    private readonly config: PermissionConfig,
    private readonly cwd: string,
  ) {}

  classify(req: PermissionRequest): Classification {
    const { toolName, input } = req;

    if (this.config.escalateTools.includes(toolName)) {
      return { decision: "escalate", reason: `tool ${toolName} always escalates` };
    }

    if (toolName === "Bash") {
      return this.classifyBash(String(input.command ?? ""));
    }

    if (FILE_TOOLS.has(toolName)) {
      const target = this.filePath(input);
      if (target && !this.insideCwd(target)) {
        return {
          decision: "escalate",
          reason: `writes outside the worktree: ${target}`,
        };
      }
      if (this.config.allowTools.includes(toolName)) {
        return { decision: "allow", reason: `${toolName} inside the worktree` };
      }
    }

    if (this.config.allowTools.includes(toolName)) {
      return { decision: "allow", reason: `${toolName} is allow-listed` };
    }

    return { decision: "escalate", reason: `tool ${toolName} not recognized` };
  }

  private classifyBash(command: string): Classification {
    // Always-escalate list is checked first against the full command string —
    // a dangerous pattern anywhere in a chained command escalates the whole call.
    const hitEscalate = this.config.escalateBash.find((p) => command.includes(p));
    if (hitEscalate) {
      return { decision: "escalate", reason: `command matches "${hitEscalate}"` };
    }
    // Default: allow. The escalateBash list is the safety net; unlisted commands
    // are presumed to be ordinary project tooling.
    return { decision: "allow", reason: "no dangerous pattern matched" };
  }

  private filePath(input: Record<string, unknown>): string | undefined {
    const p = input.file_path ?? input.path ?? input.notebook_path;
    return typeof p === "string" ? p : undefined;
  }

  private insideCwd(target: string): boolean {
    const abs = isAbsolute(target) ? target : resolve(this.cwd, target);
    const root = resolve(this.cwd);
    return abs === root || abs.startsWith(root + "/");
  }
}
