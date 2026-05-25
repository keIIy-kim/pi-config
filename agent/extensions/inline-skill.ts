import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CustomEditor, type ExtensionAPI, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

type SkillMarkerKind = "dollar" | "slash";

interface SkillInfo {
	name: string;
	commandName: string;
	description?: string;
	path: string;
	baseDir: string;
}

interface SkillMarker {
	name: string;
	kind: SkillMarkerKind;
	index: number;
}

const SKILL_NAME_PATTERN = "[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?";
const DOLLAR_MARKER_PATTERN = `(^|[^\\w$-])\\$(${SKILL_NAME_PATTERN})(?=$|[^a-z0-9-])`;
const SLASH_MARKER_PATTERN = `(^|[^\\w/-])/skill:(${SKILL_NAME_PATTERN})(?=$|[^a-z0-9-])`;
const DOLLAR_TOKEN_PATTERN = /\$([a-z0-9-]*)$/;

export default function inlineSkill(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new DollarSkillEditor(tui, theme, keybindings));
		ctx.ui.addAutocompleteProvider((current) => createDollarSkillAutocompleteProvider(pi, current));
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || !mayContainSkillMarker(event.text)) {
			return { action: "continue" };
		}

		const skills = getSkillsByName(pi);
		const transform = await expandSkillMarkers(event.text, skills);
		if (!transform) return { action: "continue" };

		if (transform.unknownSlashSkills.length > 0) {
			ctx.ui.notify(`Unknown skill invocation(s): ${transform.unknownSlashSkills.join(", ")}`, "warning");
		}

		return { action: "transform", text: transform.text, images: event.images };
	});
}

class DollarSkillEditor extends CustomEditor {
	handleInput(data: string): void {
		super.handleInput(data);

		if (this.isShowingAutocomplete() || !shouldTriggerDollarSkillAutocomplete(data, this.getLines(), this.getCursor())) {
			return;
		}

		// Pi's core editor only auto-triggers '/', '@', '#'. This extension adds '$'.
		(this as unknown as { tryTriggerAutocomplete: () => void }).tryTriggerAutocomplete();
	}
}

function createDollarSkillAutocompleteProvider(pi: ExtensionAPI, current: AutocompleteProvider): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const token = getDollarTokenBeforeCursor(lines, cursorLine, cursorCol);
			if (!token) return current.getSuggestions(lines, cursorLine, cursorCol, options);

			const items = skillsToAutocompleteItems(filterSkills(getSkills(pi), token.query));
			if (items.length === 0) return null;

			return { prefix: token.prefix, items } satisfies AutocompleteSuggestions;
		},

		applyCompletion(lines, cursorLine, cursorCol, item: AutocompleteItem, prefix) {
			if (!isDollarCompletion(prefix, item)) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}

			return applyDollarCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

function shouldTriggerDollarSkillAutocomplete(data: string, lines: string[], cursor: { line: number; col: number }): boolean {
	return isDollarAutocompleteInput(data) && Boolean(getDollarTokenBeforeCursor(lines, cursor.line, cursor.col));
}

function isDollarAutocompleteInput(data: string): boolean {
	return data === "$" || /^[a-zA-Z0-9-]$/.test(data);
}

function getDollarTokenBeforeCursor(lines: string[], cursorLine: number, cursorCol: number): { prefix: string; query: string } | null {
	const line = lines[cursorLine] ?? "";
	const beforeCursor = line.slice(0, cursorCol);
	const match = beforeCursor.match(DOLLAR_TOKEN_PATTERN);
	if (!match) return null;

	const query = match[1] ?? "";
	return { prefix: `$${query}`, query };
}

function skillsToAutocompleteItems(skills: SkillInfo[]): AutocompleteItem[] {
	return skills.map((skill) => ({
		value: `$${skill.name}`,
		label: `$${skill.name}`,
		...(skill.description ? { description: skill.description } : {}),
	}));
}

function isDollarCompletion(prefix: string, item: AutocompleteItem): boolean {
	return prefix.startsWith("$") && item.value.startsWith("$");
}

function applyDollarCompletion(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: AutocompleteItem,
	prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
	const currentLine = lines[cursorLine] ?? "";
	const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
	const afterCursor = currentLine.slice(cursorCol);
	const suffix = afterCursor.length === 0 || !/^\s/.test(afterCursor) ? " " : "";
	const newLines = [...lines];
	newLines[cursorLine] = `${beforePrefix}${item.value}${suffix}${afterCursor}`;

	return {
		lines: newLines,
		cursorLine,
		cursorCol: beforePrefix.length + item.value.length + suffix.length,
	};
}

async function expandSkillMarkers(
	text: string,
	skillsByName: Map<string, SkillInfo>,
): Promise<{ text: string; unknownSlashSkills: string[] } | null> {
	const markers = findSkillMarkers(text);
	if (markers.length === 0) return null;

	const orderedSkills = uniqueByName(markers)
		.map((marker) => skillsByName.get(marker.name))
		.filter((skill): skill is SkillInfo => Boolean(skill));
	if (orderedSkills.length === 0) return null;

	const skillBlock = await readCombinedSkillBlock(orderedSkills);
	const userMessage = removeKnownSkillMarkers(text, skillsByName).trim();
	const expandedText = userMessage ? `${skillBlock}\n\n${userMessage}` : skillBlock;

	return {
		text: normalizeBlankLines(expandedText),
		unknownSlashSkills: findUnknownSlashSkills(markers, skillsByName),
	};
}

function mayContainSkillMarker(text: string): boolean {
	return text.includes("$") || text.includes("/skill:");
}

function getSkills(pi: ExtensionAPI): SkillInfo[] {
	return pi
		.getCommands()
		.filter((command): command is SlashCommandInfo => command.source === "skill" && command.name.startsWith("skill:"))
		.map(commandToSkillInfo)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function getSkillsByName(pi: ExtensionAPI): Map<string, SkillInfo> {
	return new Map(getSkills(pi).map((skill) => [skill.name, skill]));
}

function commandToSkillInfo(command: SlashCommandInfo): SkillInfo {
	return {
		name: command.name.slice("skill:".length),
		commandName: command.name,
		description: command.description,
		path: command.sourceInfo.path,
		baseDir: command.sourceInfo.baseDir ?? dirname(command.sourceInfo.path),
	};
}

function filterSkills(skills: SkillInfo[], rawQuery: string): SkillInfo[] {
	const query = rawQuery.toLowerCase();
	if (!query) return skills;

	return skills.filter((skill) => {
		const commandName = skill.commandName.toLowerCase();
		const skillName = skill.name.toLowerCase();
		return commandName.startsWith(`skill:${query}`) || skillName.startsWith(query) || skillName.includes(query);
	});
}

function findSkillMarkers(text: string): SkillMarker[] {
	return [
		...findMarkers(text, DOLLAR_MARKER_PATTERN, "dollar"),
		...findMarkers(text, SLASH_MARKER_PATTERN, "slash"),
	].sort((a, b) => a.index - b.index);
}

function findMarkers(text: string, pattern: string, kind: SkillMarkerKind): SkillMarker[] {
	return Array.from(text.matchAll(new RegExp(pattern, "g")), (match) => ({
		name: match[2],
		kind,
		index: match.index ?? 0,
	}));
}

function uniqueByName(markers: SkillMarker[]): SkillMarker[] {
	const seen = new Set<string>();
	const result: SkillMarker[] = [];
	for (const marker of markers) {
		if (seen.has(marker.name)) continue;
		seen.add(marker.name);
		result.push(marker);
	}
	return result;
}

function findUnknownSlashSkills(markers: SkillMarker[], skillsByName: Map<string, SkillInfo>): string[] {
	const unknown = markers.filter((marker) => marker.kind === "slash" && !skillsByName.has(marker.name));
	return uniqueByName(unknown).map((marker) => marker.name);
}

function removeKnownSkillMarkers(text: string, skillsByName: Map<string, SkillInfo>): string {
	let result = removeKnownMarkers(text, DOLLAR_MARKER_PATTERN, skillsByName);
	result = removeKnownMarkers(result, SLASH_MARKER_PATTERN, skillsByName);
	return result;
}

function removeKnownMarkers(text: string, pattern: string, skillsByName: Map<string, SkillInfo>): string {
	return text.replace(new RegExp(pattern, "g"), (fullMatch: string, prefix: string, name: string) => {
		return skillsByName.has(name) ? prefix : fullMatch;
	});
}

async function readCombinedSkillBlock(skills: SkillInfo[]): Promise<string> {
	const sections = await Promise.all(skills.map(readSkillSection));
	const skillNames = skills.map((skill) => skill.name).join("+");
	const location = skills.length === 1 ? skills[0].path : `inline-skill://${skillNames}`;
	return `<skill name="${escapeAttribute(skillNames)}" location="${escapeAttribute(location)}">\n${sections.join("\n\n---\n\n")}\n</skill>`;
}

async function readSkillSection(skill: SkillInfo): Promise<string> {
	const content = await readFile(skill.path, "utf-8");
	const body = stripFrontmatter(content).trim();
	return `## ${skill.name}\n\nLocation: ${skill.path}\nReferences are relative to ${skill.baseDir}.\n\n${body}`;
}

function stripFrontmatter(markdown: string): string {
	const normalized = markdown.replace(/^\uFEFF/, "");
	const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return match ? normalized.slice(match[0].length) : normalized;
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function normalizeBlankLines(text: string): string {
	return text.replace(/\n{4,}/g, "\n\n\n").trim();
}
