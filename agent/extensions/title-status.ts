import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_DISPLAY_LENGTH = 40;

type TitleState = {
  mark: string;
  prompt: string;
};

function formatDisplay(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "";
  return cleaned.length > MAX_DISPLAY_LENGTH ? cleaned.slice(0, MAX_DISPLAY_LENGTH) + "…" : cleaned;
}

function buildTitle(mark: string, prompt: string, sessionName?: string): string {
  const prefix = (sessionName ?? "").slice(0, 3);
  const parts = [mark, prefix, formatDisplay(prompt)].filter(Boolean);
  return parts.join(" ");
}

export default function (pi: ExtensionAPI) {
  let state: TitleState = { mark: "○", prompt: "" };

  function applyTitle(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    ctx.ui.setTitle(buildTitle(state.mark, state.prompt, pi.getSessionName()));
  }

  function applyTitleAfterCoreSessionTitle(ctx: ExtensionContext) {
    applyTitle(ctx);
    setImmediate(() => applyTitle(ctx));
  }

  pi.on("session_start", async (_event, ctx) => {
    state = { mark: "○", prompt: "" };
    applyTitleAfterCoreSessionTitle(ctx);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    state = { mark: state.mark, prompt: event.prompt };
  });

  pi.on("agent_start", async (_event, ctx) => {
    state = { mark: "●", prompt: state.prompt };
    applyTitle(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    state = { mark: "○", prompt: state.prompt };
    applyTitle(ctx);
  });
}
