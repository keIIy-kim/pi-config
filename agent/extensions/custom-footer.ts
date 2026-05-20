import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const INTERVAL_MS = 1000;
const HEART_ICON = "\uf004";
const TERMINAL_ICON = "\uF120";
const FOOTER_TIMER_KEY = "__piCustomFooterTimer";
const FOOTER_HANDLERS_KEY = "__piCustomFooterHandlers";

type FooterBadge = { text: string; color: string };
type FooterHandlers = {
  extStatus: (update: unknown) => void;
  sessionStart: (_event: unknown, ctx: any) => Promise<void>;
  modelSelect: (_event: unknown, ctx: any) => Promise<void>;
  turnEnd: (_event: unknown, ctx: any) => Promise<void>;
  sessionShutdown: () => Promise<void>;
};
type FooterGlobals = typeof globalThis & {
  [FOOTER_TIMER_KEY]?: ReturnType<typeof setInterval>;
  [FOOTER_HANDLERS_KEY]?: FooterHandlers;
};

export default function (pi: ExtensionAPI) {
  const globals = globalThis as FooterGlobals;

  if (globals[FOOTER_TIMER_KEY]) {
    clearInterval(globals[FOOTER_TIMER_KEY]);
    globals[FOOTER_TIMER_KEY] = undefined;
  }
  const previousHandlers = globals[FOOTER_HANDLERS_KEY];
  if (previousHandlers) {
    (pi.events as any).off?.("ext:status", previousHandlers.extStatus);
    pi.off?.("session_start", previousHandlers.sessionStart as any);
    pi.off?.("model_select", previousHandlers.modelSelect as any);
    pi.off?.("turn_end", previousHandlers.turnEnd as any);
    pi.off?.("session_shutdown", previousHandlers.sessionShutdown as any);
    globals[FOOTER_HANDLERS_KEY] = undefined;
  }

  let tuiRequestRender: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ctxRef: any;
  let lastSessionFile: string | undefined;
  let modelReasoning = false;

  const cache = {
    cwd: "-",
    session: "-",
    model: "-",
    effort: "",
    usageText: "?%",
    usageToken: "dim" as string,
    preset: "yolo",
    extensions: [] as string[],
    extStatuses: new Map<string, FooterBadge>(),
  };

  function cleanupTimer() {
    if (timer) {
      clearInterval(timer);
      if (globals[FOOTER_TIMER_KEY] === timer) globals[FOOTER_TIMER_KEY] = undefined;
      timer = undefined;
    }
  }

  function refresh(force = false) {
    if (!ctxRef) return;
    try {
      let changed = force;
      const usage = ctxRef.getContextUsage?.();
      if (usage && usage.contextWindow > 0) {
        const pct = Math.min(100, Math.round((usage.tokens / usage.contextWindow) * 100));
        const nextUsageText = `${pct}%`;
        const nextUsageToken = pct <= 50 ? "success" : pct <= 80 ? "warning" : "error";
        if (cache.usageText !== nextUsageText || cache.usageToken !== nextUsageToken) {
          cache.usageText = nextUsageText;
          cache.usageToken = nextUsageToken;
          changed = true;
        }
      }

      const nextEffort = extractThinkingLevel();
      if (cache.effort !== nextEffort) {
        cache.effort = nextEffort;
        changed = true;
      }

      const nextPreset = readActivePreset(ctxRef);
      if (cache.preset !== nextPreset) {
        cache.preset = nextPreset;
        changed = true;
      }

      updateSession(ctxRef);
      if (changed) tuiRequestRender?.();
    } catch {
      // Never break TUI from footer refresh.
    }
  }

  function fg(theme: any, color: string, text: string) {
    try {
      return theme?.fg?.(color, text) ?? text;
    } catch {
      return text;
    }
  }

  function readActivePreset(ctx: any): string {
    try {
      const entries = ctx?.sessionManager?.getEntries?.() ?? [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry?.type !== "custom" || entry?.customType !== "preset-state") continue;
        const name = entry?.data?.name;
        return typeof name === "string" && name ? name : "yolo";
      }
    } catch {
      // Footer state is best-effort only.
    }
    return "yolo";
  }

  function presetColor(name: string) {
    switch (name) {
      case "plan": return "success";
      case "exec": return "warning";
      case "yolo": return "error";
      default: return "customMessageLabel";
    }
  }

  function effortColor(level: string) {
    switch (level) {
      case "minimal": return "muted";
      case "low": return "success";
      case "medium": return "warning";
      case "high": return "customMessageLabel";
      case "xhigh": return "error";
      case "off":
      default: return "dim";
    }
  }

  function clampLine(width: number, left: string, right: string) {
    if (width <= 0) return "";
    const safeRight = truncateToWidth(right, Math.max(0, width - 1));
    const leftMax = Math.max(0, width - visibleWidth(safeRight) - 1);
    const safeLeft = truncateToWidth(left, leftMax);
    const pad = " ".repeat(
      Math.max(0, width - visibleWidth(safeLeft) - visibleWidth(safeRight))
    );
    return truncateToWidth(`${safeLeft}${pad}${safeRight}`, width);
  }

  function renderFooter(theme: any, width: number): string[] {
    try {
      const badges: FooterBadge[] = [
        { text: HEART_ICON, color: "error" },
      ];

      for (const badge of cache.extStatuses.values()) badges.push(badge);
      for (const ext of cache.extensions) badges.push({ text: ext, color: "dim" });

      const left = badges.map((b) => fg(theme, b.color, b.text)).join("  ");
      const right = [
        fg(theme, presetColor(cache.preset), `[${cache.preset}]`),
        fg(theme, "dim", cache.session),
        fg(theme, cache.usageToken, cache.usageText),
        fg(theme, "dim", cache.model),
        cache.effort ? fg(theme, effortColor(cache.effort), cache.effort) : "",
      ].filter(Boolean).join(" ");

      return [clampLine(width, left, right)];
    } catch {
      return [""];
    }
  }

  function extractSessionName(file?: string): string {
    const name = pi.getSessionName?.();
    if (name) return String(name);
    if (typeof file === "string") {
      const m = file.match(/_([0-9a-f]{8})-[0-9a-f-]+\.jsonl$/);
      if (m) return m[1];
    }
    return "-";
  }

  function extractThinkingLevel(): string {
    if (!modelReasoning) return "";
    try {
      return String(pi.getThinkingLevel?.() || ctxRef?.thinkingLevel || "off");
    } catch {
      return String(ctxRef?.thinkingLevel || "off");
    }
  }

  function updateCwd(ctx: any) {
    const next = String(ctx?.cwd ?? "-").split("/").pop() || "-";
    if (cache.cwd !== next) cache.cwd = next;
  }

  function updateSession(ctx: any) {
    const file = ctx?.sessionManager?.getSessionFile?.();
    lastSessionFile = file;
    const next = extractSessionName(file);
    if (cache.session !== next) cache.session = next;
  }

  function updateModel(ctx: any) {
    const model = ctx?.model;
    const next = String(model?.id ?? "-");
    if (cache.model !== next) {
      cache.model = next;
      modelReasoning = !!model?.reasoning;
    }
    const nextEffort = extractThinkingLevel();
    if (cache.effort !== nextEffort) cache.effort = nextEffort;
  }

  function updateExtensions(ctx: any) {
    const raw = ctx?.footerData?.getExtensionStatuses?.() ?? [];
    const next = raw.map((s: unknown) => String(s));
    if (next.length !== cache.extensions.length || next.some((v, i) => v !== cache.extensions[i])) {
      cache.extensions = next;
    }
  }

  function updateCache(ctx: any) {
    ctxRef = ctx;
    updateCwd(ctx);
    updateSession(ctx);
    updateModel(ctx);
    cache.preset = readActivePreset(ctx);
    updateExtensions(ctx);
  }

  function setupFooter(ctx: any) {
    cleanupTimer();
    updateCache(ctx);
    ctx.ui.setFooter((tui: any, theme: any) => {
      tuiRequestRender = () => tui?.requestRender?.();
      return {
        render(width: number) {
          return renderFooter(theme, width);
        },
        invalidate() {},
        dispose() {
          cleanupTimer();
          tuiRequestRender = undefined;
        },
      };
    });
    timer = setInterval(() => refresh(false), INTERVAL_MS);
    globals[FOOTER_TIMER_KEY] = timer;
  }

  const handlers: FooterHandlers = {
    extStatus(update: unknown) {
      if (update && typeof update === "object") {
        const u = update as any;
        const key = String(u.key ?? "");
        const text = String(u.text ?? "");
        const color = String(u.color ?? "dim");
        if (key) {
          if (text) {
            cache.extStatuses.set(key, { text, color });
          } else {
            cache.extStatuses.delete(key);
          }
        }
      }
      refresh(true);
    },
    async sessionStart(_event: unknown, ctx: any) {
      setupFooter(ctx);
      refresh(true);
    },
    async modelSelect(_event: unknown, ctx: any) {
      updateCache(ctx);
      refresh(true);
    },
    async turnEnd(_event: unknown, ctx: any) {
      updateCache(ctx);
      refresh(true);
    },
    async sessionShutdown() {
      cleanupTimer();
      tuiRequestRender = undefined;
      ctxRef = undefined;
      lastSessionFile = undefined;
      cache.extStatuses.clear();
    },
  };

  (pi.events as any).on?.("ext:status", handlers.extStatus);
  pi.on("session_start", handlers.sessionStart as any);
  pi.on("model_select", handlers.modelSelect as any);
  pi.on("turn_end", handlers.turnEnd as any);
  pi.on("session_shutdown", handlers.sessionShutdown as any);
  globals[FOOTER_HANDLERS_KEY] = handlers;
}
