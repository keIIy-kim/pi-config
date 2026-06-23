import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

let lastActiveCwd: string | undefined;
let lastReason = "session cwd";
let lastConfidence = 0;

function shellWords(command: string): string[] {
  const words = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return words.map((word) => word.replace(/^(['"])(.*)\1$/, "$2"));
}

function inferCwdFromBash(command: string, cwd: string): { cwd: string; reason: string; confidence: number } | undefined {
  const cdMatch = command.match(/(?:^|[;&|]\s*)cd\s+((?:"[^"]+")|(?:'[^']+')|[^;&|]+?)\s*(?:&&|;|$)/);
  if (cdMatch?.[1]) {
    const raw = cdMatch[1].trim().replace(/^(['"])(.*)\1$/, "$2");
    return { cwd: resolve(cwd, raw), reason: `bash cd ${raw}`, confidence: 3 };
  }

  const words = shellWords(command);
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === "-C") {
      return { cwd: resolve(cwd, words[i + 1]), reason: `git -C ${words[i + 1]}`, confidence: 3 };
    }
  }

  return undefined;
}

function inferCwdFromPath(pathValue: unknown, cwd: string, reason: string): { cwd: string; reason: string; confidence: number } | undefined {
  if (typeof pathValue !== "string" || pathValue.length === 0) return undefined;
  const absolute = isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
  const candidate = existsSync(absolute) && statSync(absolute).isDirectory() ? absolute : dirname(absolute);
  return { cwd: candidate, reason, confidence: 1 };
}

async function execText(pi: ExtensionAPI, args: string[], cwd: string): Promise<string> {
  const result = await pi.exec("git", args, { cwd, timeout: 5_000 });
  if (result.code !== 0) {
    throw new Error(`${result.stderr ?? result.stdout ?? "git command failed"}`.trim());
  }
  return `${result.stdout ?? ""}`.trim();
}

async function gitRoot(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000 });
  if (result.code !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

function summarizePorcelain(output: string) {
  const counts = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
    total: 0,
  };

  for (const line of output.split("\n").filter(Boolean)) {
    if (line.startsWith("##")) continue;
    counts.total++;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const status = `${x}${y}`;
    if (status === "??") counts.untracked++;
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status) || x === "U" || y === "U") counts.conflicted++;
    if (x === "A" || y === "A") counts.added++;
    if (x === "M" || y === "M") counts.modified++;
    if (x === "D" || y === "D") counts.deleted++;
    if (x === "R" || y === "R") counts.renamed++;
  }

  return counts;
}

function statusText(counts: ReturnType<typeof summarizePorcelain>) {
  if (counts.total === 0) return "clean";
  const parts = [`${counts.total} files`];
  if (counts.modified) parts.push(`${counts.modified} modified`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.deleted) parts.push(`${counts.deleted} deleted`);
  if (counts.renamed) parts.push(`${counts.renamed} renamed`);
  if (counts.untracked) parts.push(`${counts.untracked} untracked`);
  if (counts.conflicted) parts.push(`${counts.conflicted} conflicted`);
  return parts.join(", ");
}

async function buildReport(pi: ExtensionAPI, sessionCwd: string): Promise<string> {
  const activeCwd = lastActiveCwd ?? sessionCwd;
  const root = await gitRoot(pi, activeCwd);
  if (!root) {
    return [
      `Pi cwd:      ${sessionCwd}`,
      `Active cwd:  ${activeCwd}`,
      `Git:         none`,
      `Reason:      ${lastReason}`,
    ].join("\n");
  }

  const [branch, upstream, aheadBehind, porcelain] = await Promise.all([
    execText(pi, ["branch", "--show-current"], root),
    execText(pi, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root).catch(() => ""),
    execText(pi, ["rev-list", "--left-right", "--count", "@{u}...HEAD"], root).catch(() => ""),
    execText(pi, ["status", "--porcelain=v1", "--branch"], root),
  ]);

  const [behind, ahead] = aheadBehind.split(/\s+/).map((value) => Number(value || 0));
  const counts = summarizePorcelain(porcelain);
  const upstreamText = upstream || "none";
  const syncText = upstream ? `ahead ${ahead || 0}, behind ${behind || 0}` : "no upstream";

  return [
    `Pi cwd:      ${sessionCwd}`,
    `Active cwd:  ${activeCwd}`,
    `Git root:    ${root}`,
    `Branch:      ${branch || "(detached)"}`,
    `Tracking:    ${upstreamText}`,
    `Sync:        ${syncText}`,
    `Changes:     ${statusText(counts)}`,
    `Reason:      ${lastReason}`,
  ].join("\n");
}

function rememberToolCall(toolName: string, input: unknown, cwd: string) {
  let inferred: { cwd: string; reason: string; confidence: number } | undefined;

  if (toolName === "bash") {
    const bashInput = input as { command?: unknown };
    if (typeof bashInput.command === "string") inferred = inferCwdFromBash(bashInput.command, cwd);
  } else if (["read", "write", "edit"].includes(toolName)) {
    const pathInput = input as { path?: unknown };
    inferred = inferCwdFromPath(pathInput.path, cwd, `${toolName} path`);
  }

  if (inferred?.cwd && inferred.confidence >= lastConfidence) {
    lastActiveCwd = inferred.cwd;
    lastReason = inferred.reason;
    lastConfidence = inferred.confidence;
  }
}

function restoreFromSession(ctx: { cwd: string; sessionManager: { getBranch(): unknown[] } }) {
  lastActiveCwd = ctx.cwd;
  lastReason = "session cwd";
  lastConfidence = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    const maybeEntry = entry as {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    if (maybeEntry.type !== "message" || maybeEntry.message?.role !== "assistant") continue;
    const content = maybeEntry.message.content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      const maybeToolCall = item as { type?: string; name?: string; arguments?: unknown };
      if (maybeToolCall.type !== "toolCall" || !maybeToolCall.name) continue;
      rememberToolCall(maybeToolCall.name, maybeToolCall.arguments, ctx.cwd);
    }
  }
}

export default function whereExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    restoreFromSession(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    rememberToolCall(event.toolName, event.input, ctx.cwd);
  });

  pi.registerCommand("where", {
    description: "Show current inferred worktree, branch, and change counts",
    handler: async (_args, ctx) => {
      const report = await buildReport(pi, ctx.cwd);
      ctx.ui.notify(report, "info");
    },
  });
}
