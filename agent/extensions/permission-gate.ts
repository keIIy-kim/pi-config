/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, sudo, chmod/chown 777
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const COMMAND_SEPARATORS = new Set([";", "&", "|", "&&", "||", "(", ")"]);

function shellTokens(command: string): string[] {
	const tokens = command.match(/&&|\|\||[;&|()]|"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|[^\s;&|()]+/g) ?? [];
	return tokens.map((token) => token.replace(/^(['"])(.*)\1$/, "$2"));
}

function isRmCommand(token: string): boolean {
	return token === "rm" || token.endsWith("/rm");
}

function isRecursiveRmFlag(token: string): boolean {
	if (token === "--") return false;
	if (token === "--recursive") return true;
	return /^-[^-]*[rR]/.test(token);
}

function containsRecursiveRm(command: string): boolean {
	const tokens = shellTokens(command);
	for (let i = 0; i < tokens.length; i++) {
		if (!isRmCommand(tokens[i] ?? "")) continue;
		for (let j = i + 1; j < tokens.length; j++) {
			const token = tokens[j] ?? "";
			if (COMMAND_SEPARATORS.has(token)) break;
			if (isRecursiveRmFlag(token)) return true;
			if (token === "--") break;
		}
	}
	return false;
}

export default function (pi: ExtensionAPI) {
	const dangerousPatterns = [/\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		const isDangerous = containsRecursiveRm(command) || dangerousPatterns.some((p) => p.test(command));

		if (isDangerous) {
			if (!ctx.hasUI) {
				// In non-interactive mode, block by default
				return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
			}

			const choice = await ctx.ui.select(`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		}

		return undefined;
	});
}
