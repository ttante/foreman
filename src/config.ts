import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";

export interface PermissionConfig {
  /** Bash command substrings that are auto-approved. */
  allowBash: string[];
  /** Bash command substrings that always escalate (checked first). */
  escalateBash: string[];
  /** Tool names auto-approved when their target stays inside the worktree. */
  allowTools: string[];
  /** Tool names that always escalate. */
  escalateTools: string[];
}

export interface NotificationsConfig {
  /** Fire a desktop notification when the builder needs user input. Default: false. */
  enabled: boolean;
}

export interface QaConfig {
  /** Run a QA review pass after each completed ticket or step. Default: true. */
  enabled: boolean;
}

export interface ForemanConfig {
  permissions: PermissionConfig;
  notifications: NotificationsConfig;
  qa: QaConfig;
}

/** Built-in defaults; foreman.yaml overrides any field present. */
export const DEFAULT_CONFIG: ForemanConfig = {
  permissions: {
    allowBash: [
      "npm test",
      "npm run",
      "npm install",
      "npm ci",
      "npx tsc",
      "node ",
      "pnpm ",
      "yarn ",
      "git status",
      "git diff",
      "git add",
      "git commit",
      "git log",
      "git branch",
      "git checkout",
      "git restore",
      "git stash",
      "ls",
      "cat ",
      "mkdir ",
      "pytest",
      "python ",
      "python3 ",
      "make ",
      "cargo ",
      "go test",
      "go build",
    ],
    escalateBash: [
      "rm -rf",
      "rm -r",
      "sudo",
      "git push",
      "git reset --hard",
      "git clean",
      "curl",
      "wget",
      "ssh",
      "scp",
      "docker",
      "kubectl",
      "chmod 777",
      "> /dev",
      ":(){",
      "mkfs",
      "dd if=",
    ],
    allowTools: [
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "MultiEdit",
      "NotebookEdit",
      "TodoWrite",
    ],
    escalateTools: ["WebFetch", "WebSearch"],
  },
  notifications: { enabled: false },
  qa: { enabled: true },
};

/** Load foreman.yaml if present and deep-merge it over the defaults. */
export function loadConfig(path = "foreman.yaml"): ForemanConfig {
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const raw = parse(readFileSync(path, "utf8")) ?? {};
  return {
    permissions: { ...DEFAULT_CONFIG.permissions, ...(raw.permissions ?? {}) },
    notifications: {
      ...DEFAULT_CONFIG.notifications,
      ...(raw.notifications ?? {}),
    } as NotificationsConfig,
    qa: { ...DEFAULT_CONFIG.qa, ...(raw.qa ?? {}) } as QaConfig,
  };
}
