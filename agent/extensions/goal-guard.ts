import * as fs from "node:fs";
import * as path from "node:path";

import goalExtension from "/Users/kelly/.pi/agent/npm/node_modules/@capyup/pi-goal/extensions/goal.ts";

type ExtensionContext = {
  cwd: string;
  hasUI: boolean;
  ui: { setStatus(key: string, text: string | undefined): void };
  sessionManager: { getBranch(...args: unknown[]): unknown[]; [key: string]: unknown };
  [key: string]: unknown;
};

type ExtensionCommandContext = ExtensionContext;

type ExtensionAPI = {
  on(eventName: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): unknown;
  registerCommand(name: string, options: CommandOptions): unknown;
  [key: string]: unknown;
};

type CommandOptions = {
  handler?: (args: string, ctx: ExtensionCommandContext) => unknown;
  [key: string]: unknown;
};

const STATE_ENTRY = "pi-goal-state";
const FOCUS_ENTRY = "pi-goal-focus";
const GOALS_DIR = ".pi/goals";

interface GoalLike {
  id?: unknown;
  status?: unknown;
  activePath?: unknown;
}

interface GuardStats {
  blockedStateEntries: number;
  blockedFocusEntries: number;
}

let lastStats: GuardStats = { blockedStateEntries: 0, blockedFocusEntries: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "goal";
}

function normalizeRelPath(value: string): string {
  return value.split(/[\\/]+/).join("/");
}

function isSafeActiveGoalPath(cwd: string, value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  if (path.isAbsolute(value) || value.includes("\0")) return false;

  const relPath = normalizeRelPath(value);
  if (path.posix.dirname(relPath) !== GOALS_DIR) return false;
  if (!/^active_goal_.*\.md$/.test(path.posix.basename(relPath))) return false;

  const root = path.resolve(cwd, GOALS_DIR);
  const absolutePath = path.resolve(cwd, relPath);
  const relative = path.relative(root, absolutePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function parseGoalIdFromFile(filePath: string): string | null {
  let content: string;
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) return null;
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0) {
        try {
          const raw = JSON.parse(content.slice(0, i + 1));
          return typeof raw?.id === "string" ? safeIdPart(raw.id) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function currentActiveGoalIds(cwd: string): Set<string> {
  const ids = new Set<string>();
  const root = path.resolve(cwd, GOALS_DIR);
  let entries: string[];
  try {
    if (fs.lstatSync(root).isSymbolicLink()) return ids;
    entries = fs.readdirSync(root);
  } catch {
    return ids;
  }

  for (const name of entries) {
    if (!/^active_goal_.*\.md$/.test(name)) continue;
    const id = parseGoalIdFromFile(path.join(root, name));
    if (id) ids.add(id);
  }
  return ids;
}

function isGoalBackedByCurrentCwd(cwd: string, goal: GoalLike): boolean {
  if (goal.status === "complete") return true;
  if (typeof goal.id !== "string") return false;
  if (!isSafeActiveGoalPath(cwd, goal.activePath)) return false;

  const absolutePath = path.resolve(cwd, goal.activePath);
  const diskGoalId = parseGoalIdFromFile(absolutePath);
  return diskGoalId === safeIdPart(goal.id);
}

function filterBranchForCwd(branch: unknown[], cwd: string): unknown[] {
  const currentIds = currentActiveGoalIds(cwd);
  let blockedStateEntries = 0;
  let blockedFocusEntries = 0;

  const filtered = branch.filter((entry) => {
    if (!isRecord(entry) || entry.type !== "custom") return true;

    if (entry.customType === STATE_ENTRY) {
      const goal = isRecord(entry.data) ? entry.data.goal : undefined;
      if (!isRecord(goal) || goal.status === "complete") return true;
      const keep = isGoalBackedByCurrentCwd(cwd, goal);
      if (!keep) blockedStateEntries++;
      return keep;
    }

    if (entry.customType === FOCUS_ENTRY) {
      const focusedGoalId = isRecord(entry.data) ? entry.data.focusedGoalId : undefined;
      if (typeof focusedGoalId !== "string" || !focusedGoalId.trim()) return true;
      const keep = currentIds.has(safeIdPart(focusedGoalId));
      if (!keep) blockedFocusEntries++;
      return keep;
    }

    return true;
  });

  lastStats = { blockedStateEntries, blockedFocusEntries };
  return filtered;
}

function guardedContext<T extends ExtensionContext>(ctx: T): T {
  const sessionManager = new Proxy(ctx.sessionManager, {
    get(target, prop, receiver) {
      if (prop === "getBranch") {
        return (...args: unknown[]) => filterBranchForCwd(
          Reflect.apply(target.getBranch, target, args),
          ctx.cwd,
        );
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { ...ctx, sessionManager } as T;
}

function blockedEntryText(total: number): string | undefined {
  if (total <= 0) return undefined;
  return `goal-guard: blocked ${total} stale focus ${total === 1 ? "entry" : "entries"}`;
}

function refreshGuardStatus(ctx: ExtensionContext): void {
  filterBranchForCwd(ctx.sessionManager.getBranch(), ctx.cwd);
  if (!ctx.hasUI) return;

  const total = lastStats.blockedStateEntries + lastStats.blockedFocusEntries;
  ctx.ui.setStatus("goal-guard", blockedEntryText(total));
}

function wrapCommandOptions(options: CommandOptions): CommandOptions {
  if (!options.handler) return options;
  return {
    ...options,
    handler: (args: string, ctx: ExtensionCommandContext) => options.handler?.(args, guardedContext(ctx)),
  };
}

export default function goalGuardExtension(pi: ExtensionAPI): void {
  const guardedPi = new Proxy(pi, {
    get(target, prop, receiver) {
      if (prop === "on") {
        return (eventName: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
          return target.on(eventName as never, ((event: unknown, ctx: ExtensionContext) => {
            return handler(event, guardedContext(ctx));
          }) as never);
        };
      }

      if (prop === "registerCommand") {
        return (name: string, options: CommandOptions) => {
          return target.registerCommand(name, wrapCommandOptions(options));
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ExtensionAPI;

  goalExtension(guardedPi as never);

  for (const eventName of ["session_start", "session_tree", "before_agent_start"]) {
    pi.on(eventName, async (_event: unknown, ctx: ExtensionContext) => {
      refreshGuardStatus(ctx);
    });
  }
}
