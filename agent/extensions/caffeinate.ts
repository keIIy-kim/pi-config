import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";

const PROC_KEY = "__piCaffeinateProc";
const HANDLERS_KEY = "__piCaffeinateHandlers";
const CAFFEINATE_ICON = "\uF005";
const ACTIVE_COLOR = "warning";
const INACTIVE_COLOR = "dim";
const CAFFEINATE_ARGS = ["-w", String(process.pid), "-di"];

type CaffeinateHandlers = {
  start: () => Promise<void>;
  end: () => Promise<void>;
  sessionStart: () => Promise<void>;
  shutdown: () => Promise<void>;
};
type CaffeinateGlobals = typeof globalThis & {
  [PROC_KEY]?: ChildProcess | null;
  [HANDLERS_KEY]?: CaffeinateHandlers;
};

export default function (pi: ExtensionAPI) {
  const globals = globalThis as CaffeinateGlobals;

  if (globals[HANDLERS_KEY]) {
    pi.off?.("agent_start", globals[HANDLERS_KEY].start as any);
    pi.off?.("agent_end", globals[HANDLERS_KEY].end as any);
    pi.off?.("session_start", globals[HANDLERS_KEY].sessionStart as any);
    pi.off?.("session_shutdown", globals[HANDLERS_KEY].shutdown as any);
    globals[HANDLERS_KEY] = undefined;
  }

  killChild(globals[PROC_KEY]);
  globals[PROC_KEY] = null;

  let proc: ChildProcess | null = null;

  function setStatus(text: string, color: string) {
    (pi as any).events?.emit("ext:status", { key: "caffeinate", text, color });
  }

  function killChild(child: ChildProcess | null | undefined) {
    if (!child || child.killed) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore cleanup failures
    }
  }

  function stop() {
    killChild(proc);
    proc = null;
    globals[PROC_KEY] = null;
    setStatus(CAFFEINATE_ICON, INACTIVE_COLOR);
  }

  function begin() {
    stop();

    const nextProc = spawn("caffeinate", CAFFEINATE_ARGS, {
      detached: false,
      stdio: "ignore",
    });

    if (!nextProc.pid) {
      setStatus(CAFFEINATE_ICON, INACTIVE_COLOR);
      return;
    }

    proc = nextProc;
    globals[PROC_KEY] = nextProc;
    nextProc.once("exit", () => {
      if (proc === nextProc) proc = null;
      if (globals[PROC_KEY] === nextProc) globals[PROC_KEY] = null;
    });
    nextProc.unref();

    setStatus(CAFFEINATE_ICON, ACTIVE_COLOR);
  }

  const handlers: CaffeinateHandlers = {
    async start() {
      begin();
    },
    async end() {
      stop();
    },
    async sessionStart() {
      setStatus(CAFFEINATE_ICON, proc ? ACTIVE_COLOR : INACTIVE_COLOR);
    },
    async shutdown() {
      stop();
      if (globals[HANDLERS_KEY]) {
        pi.off?.("agent_start", globals[HANDLERS_KEY].start as any);
        pi.off?.("agent_end", globals[HANDLERS_KEY].end as any);
        pi.off?.("session_start", globals[HANDLERS_KEY].sessionStart as any);
        pi.off?.("session_shutdown", globals[HANDLERS_KEY].shutdown as any);
        globals[HANDLERS_KEY] = undefined;
      }
    },
  };

  pi.on("agent_start", handlers.start as any);
  pi.on("agent_end", handlers.end as any);
  pi.on("session_start", handlers.sessionStart as any);
  pi.on("session_shutdown", handlers.shutdown as any);
  globals[HANDLERS_KEY] = handlers;
}
