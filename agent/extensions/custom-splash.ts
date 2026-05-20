import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

type Rgb = [number, number, number];

// Palette from /Users/kelly/.config/pi/agent/themes/soft-dracula.json.
const PALETTE: Rgb[] = [
  [196, 162, 247],
  [243, 135, 199],
  [154, 231, 244],
  [117, 235, 150],
  [154, 231, 244],
  [243, 135, 199],
];

const TITLE_LINES = [
  "  ██████╗  ██╗ ",
  "  ██╔══██╗ ██║ ",
  "  ██████╔╝ ██║ ",
  "  ██╔═══╝  ██║ ",
  "  ██║      ██║ ",
  "  ╚═╝      ╚═╝ ",
];

function mix(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function colorAt(position: number): Rgb {
  const scaled = Math.max(0, Math.min(0.999, position)) * PALETTE.length;
  const index = Math.floor(scaled);
  const nextIndex = Math.min(index + 1, PALETTE.length - 1);
  const t = scaled - index;
  const a = PALETTE[index]!;
  const b = PALETTE[nextIndex]!;
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function fg([r, g, b]: Rgb, text: string) {
  return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function gradient(text: string) {
  const chars = [...text];
  const span = Math.max(chars.length - 1, 1);
  return chars
    .map((char, index) => {
      if (char === " ") return char;
      return fg(colorAt(index / span), char);
    })
    .join("");
}

function center(text: string, width: number) {
  const length = [...text].length;
  if (length >= width) return text;
  return `${" ".repeat(Math.floor((width - length) / 2))}${text}`;
}

function projectName(cwd: string) {
  return path.basename(cwd) || "session";
}

function renderSplash(width: number, subtitle: string) {
  return [
    "",
    ...TITLE_LINES.map((line) => gradient(center(line, width))),
    `${BOLD}${gradient(center(subtitle, width))}${RESET}`,
    "",
  ];
}

export default function customSplash(pi: ExtensionAPI) {
  let requestRender: (() => void) | undefined;
  let currentModelId = "no model";
  let currentCwd = process.cwd();

  function subtitle() {
    return `${currentModelId} · ${projectName(currentCwd)}`;
  }

  function installHeader(ctx: ExtensionContext) {
    currentModelId = ctx.model?.id ?? currentModelId;
    currentCwd = ctx.cwd ?? currentCwd;

    ctx.ui.setHeader((tui: { requestRender(force?: boolean): void }) => {
      requestRender = () => tui.requestRender();
      return {
        render(width: number) {
          return renderSplash(width, subtitle());
        },
        invalidate() {
          tui.requestRender();
        },
        dispose() {
          requestRender = undefined;
        },
      };
    });
  }

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    installHeader(ctx);
  });

  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
    requestRender?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setHeader(undefined);
  });

}
