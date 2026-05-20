import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function formatDisplay(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "…";
  return cleaned.length > 40 ? cleaned.slice(0, 40) + "…" : cleaned;
}

function buildTitle(mark: string, prompt: string, sessionName?: string): string {
  const prefix = (sessionName ?? "").slice(0, 3);
  const prefixPart = prefix ? `${prefix} ` : "";
  const display = formatDisplay(prompt);
  return `${mark} ${prefixPart}${display}`;
}

export default function (pi: ExtensionAPI) {
  let lastPrompt = "";

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setTitle(buildTitle("○", "", pi.getSessionName()));
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    lastPrompt = event.prompt;
  });

  pi.on("agent_start", async (_event, ctx) => {
    ctx.ui.setTitle(buildTitle("●", lastPrompt, pi.getSessionName()));
  });

  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.setTitle(buildTitle("○", lastPrompt, pi.getSessionName()));
  });
}
