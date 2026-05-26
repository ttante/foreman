import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface TicketsPaths {
  tickets: string;
  stateDb: string;
  trackerRules: string;
  progressDoc: string;
  archiveDoc: string;
}

export interface TicketsRendering {
  preserveLegacyLlmQueueHeading: boolean;
  includeRulesInProgressDoc: boolean;
  maxWorkLogRows: number;
  maxValidationSnapshotRows: number;
  maxRecentCompletedRows: number;
  generatedDocWarning: boolean;
}

export interface TicketsBehavior {
  regenerateProgressDocAfterEveryUpdate: boolean;
  requireValidationEvidenceForDone: boolean;
  blockOnUnresolvedDependencies: boolean;
  useAtomicFileWrites: boolean;
  backupBeforeImportOrMigration: boolean;
}

export interface TicketsConfig {
  appName: string;
  queueLimit: number;
  timezone: string;
  paths: TicketsPaths;
  rendering: TicketsRendering;
  behavior: TicketsBehavior;
}

export const DEFAULT_TICKETS_CONFIG: TicketsConfig = {
  appName: "My App",
  queueLimit: 50,
  timezone: "UTC",
  paths: {
    tickets: ".tickets/tickets.yaml",
    stateDb: ".tickets/ticket-state.sqlite",
    trackerRules: ".tickets/tracker-rules.md",
    progressDoc: "docs/ticket-progress.md",
    archiveDoc: "docs/ticket-archive.md",
  },
  rendering: {
    preserveLegacyLlmQueueHeading: true,
    includeRulesInProgressDoc: true,
    maxWorkLogRows: 50,
    maxValidationSnapshotRows: 20,
    maxRecentCompletedRows: 20,
    generatedDocWarning: true,
  },
  behavior: {
    regenerateProgressDocAfterEveryUpdate: true,
    requireValidationEvidenceForDone: true,
    blockOnUnresolvedDependencies: true,
    useAtomicFileWrites: true,
    backupBeforeImportOrMigration: true,
  },
};

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => (c as string).toUpperCase());
}

function camelizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[snakeToCamel(k)] = v;
  }
  return result;
}

export function loadTicketsConfig(projectDir: string): TicketsConfig {
  const configPath = join(projectDir, ".tickets", "config.yaml");
  if (!existsSync(configPath)) {
    return {
      ...DEFAULT_TICKETS_CONFIG,
      paths: { ...DEFAULT_TICKETS_CONFIG.paths },
      rendering: { ...DEFAULT_TICKETS_CONFIG.rendering },
      behavior: { ...DEFAULT_TICKETS_CONFIG.behavior },
    };
  }
  const raw = (parse(readFileSync(configPath, "utf8")) as Record<string, unknown>) ?? {};
  return {
    appName: (raw.app_name as string) ?? DEFAULT_TICKETS_CONFIG.appName,
    queueLimit: (raw.queue_limit as number) ?? DEFAULT_TICKETS_CONFIG.queueLimit,
    timezone: (raw.timezone as string) ?? DEFAULT_TICKETS_CONFIG.timezone,
    paths: {
      ...DEFAULT_TICKETS_CONFIG.paths,
      ...(raw.paths ? camelizeObject(raw.paths as Record<string, unknown>) : {}),
    } as TicketsPaths,
    rendering: {
      ...DEFAULT_TICKETS_CONFIG.rendering,
      ...(raw.rendering ? camelizeObject(raw.rendering as Record<string, unknown>) : {}),
    } as TicketsRendering,
    behavior: {
      ...DEFAULT_TICKETS_CONFIG.behavior,
      ...(raw.behavior ? camelizeObject(raw.behavior as Record<string, unknown>) : {}),
    } as TicketsBehavior,
  };
}

export function isTicketsInitialized(projectDir: string): boolean {
  return existsSync(join(projectDir, ".tickets", "config.yaml"));
}

export function resolveTicketPaths(
  config: TicketsConfig,
  projectDir: string,
): {
  tickets: string;
  stateDb: string;
  trackerRules: string;
  progressDoc: string;
  archiveDoc: string;
} {
  const p = config.paths;
  const r = (rel: string) => join(projectDir, rel);
  return {
    tickets: r(p.tickets),
    stateDb: r(p.stateDb),
    trackerRules: r(p.trackerRules),
    progressDoc: r(p.progressDoc),
    archiveDoc: r(p.archiveDoc),
  };
}
