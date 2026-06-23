import { appendFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CustomEditor, type ExtensionAPI, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

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

interface SkillCategory {
	id: string;
	aliases: string[];
	description: string;
	skills: string[];
}

interface DollarToken {
	prefix: string;
	query: string;
	category?: SkillCategory;
	categoryQuery?: string;
}

interface SkillTransform {
	text: string;
	unknownSlashSkills: string[];
	knownMarkers: SkillMarker[];
	orderedSkills: SkillInfo[];
}

interface UsageEvent {
	ts: string;
	type: "explicit" | "auto-read";
	source: "inline-skill" | "tool_call";
	skills: string[];
	markers?: Array<{ name: string; kind: SkillMarkerKind }>;
	path?: string;
	toolCallId?: string;
}

interface UsageCleanupResult {
	rotated: boolean;
	maxBytes: number;
	keep: number;
	sizeBytes: number;
	message: string;
}

interface SkillCatalogStats {
	totalSkills: number;
	categoryCount: number;
	categorizedSkills: number;
	uncategorizedSkills: string[];
	llmVisibleSkills: number;
	userOnlySkills: string[];
	manualOnlyMissing: string[];
	categoryRows: Array<{ id: string; count: number }>;
}

const SKILL_NAME_PATTERN = "[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?";
const DOLLAR_MARKER_PATTERN = `(^|[^\\w$-])\\$(${SKILL_NAME_PATTERN})(?=$|[^a-z0-9-])`;
const SLASH_MARKER_PATTERN = `(^|[^\\w/-])/skill:(${SKILL_NAME_PATTERN})(?=$|[^a-z0-9-])`;
const DOLLAR_TOKEN_PATTERN = /\$([a-z0-9-]*(?::[a-z0-9-]*)?)$/;

const DEFAULT_SKILL_CATEGORIES: SkillCategory[] = [
	{
		id: "plan",
		aliases: ["design", "arch", "domain", "prd", "issue", "triage", "handoff"],
		description: "design, plan, PRD, issues, triage, handoff",
		skills: [
			"critical-ai-partner",
			"codebase-design",
			"domain-modeling",
			"grilling",
			"grill-me",
			"grill-with-docs",
			"improve-codebase-architecture",
			"prototype",
			"to-prd",
			"to-issues",
			"triage",
			"handoff",
			"ask-matt",
		],
	},
	{
		id: "code",
		aliases: ["build", "implement", "dev", "work"],
		description: "implement, TDD, prototype, worktree, conflicts",
		skills: ["workspace", "implement", "tdd", "prototype", "resolving-merge-conflicts", "critical-ai-partner"],
	},
	{
		id: "debug",
		aliases: ["fix", "bug", "diagnose", "broken", "failing", "slow"],
		description: "debug bugs, failures, regressions, slow behavior",
		skills: ["diagnosing-bugs", "critical-ai-partner", "tdd"],
	},
	{
		id: "review",
		aliases: ["check", "audit", "inspect", "pr", "ship", "release", "simplify"],
		description: "review, release check, audit, simplify",
		skills: [
			"code-review-checklist",
			"release-validation",
			"ponytail-review",
			"ponytail-audit",
			"ponytail-debt",
			"critical-ai-partner",
		],
	},
	{
		id: "research",
		aliases: ["docs", "web", "source", "verify", "facts"],
		description: "research, docs, source-backed facts, safe summaries",
		skills: ["research-with-sources", "product-docs-verifier", "copyright-safe-summary"],
	},
	{
		id: "artifact",
		aliases: ["make", "artifacts", "deliverable", "file", "html", "slides", "ui"],
		description: "files, HTML artifacts, demos, slides",
		skills: ["file-deliverable-router", "artifact-html-builder", "frontend-slides"],
	},
	{
		id: "mode",
		aliases: ["workflow", "talk", "meta", "skill", "teach", "help", "yagni", "lazy"],
		description: "answer style, YAGNI mode, teaching, skill help",
		skills: ["caveman", "ponytail", "ponytail-help", "ponytail-gain", "teach", "writing-great-skills"],
	},
	{
		id: "all",
		aliases: ["everything"],
		description: "show every installed skill",
		skills: [],
	},
];

const HELPER_DIR = join(dirname(fileURLToPath(import.meta.url)), "../skills/_helper");
const CATALOG_PATH = join(HELPER_DIR, "categories.json");
const USAGE_LOG_PATH = join(HELPER_DIR, "usage.jsonl");
const DEFAULT_USAGE_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_USAGE_KEEP = 10;
let skillCategoriesCache: SkillCategory[] | null = null;

function getSkillCategories(): SkillCategory[] {
	if (skillCategoriesCache) return skillCategoriesCache;

	try {
		const parsed = JSON.parse(readFileSync(CATALOG_PATH, "utf-8")) as { categories?: SkillCategory[] };
		if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
			skillCategoriesCache = parsed.categories;
			return skillCategoriesCache;
		}
	} catch {
		// Fall back to built-in categories; picker should never fail because catalog JSON is missing/bad.
	}

	skillCategoriesCache = DEFAULT_SKILL_CATEGORIES;
	return skillCategoriesCache;
}

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

		await safeLogUsageEvent({
			ts: new Date().toISOString(),
			type: "explicit",
			source: "inline-skill",
			skills: transform.orderedSkills.map((skill) => skill.name),
			markers: transform.knownMarkers.map(({ name, kind }) => ({ name, kind })),
		});

		let text = transform.text;
		if (transform.orderedSkills.some((skill) => skill.name === "skill-helper")) {
			try {
				const { report, cleanup } = await createSkillHelperReportAndCleanup(getSkills(pi));
				text = appendSkillHelperReport(text, report, cleanup);
			} catch (error) {
				ctx.ui.notify(`Skill helper report failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		}

		if (transform.unknownSlashSkills.length > 0) {
			ctx.ui.notify(`Unknown skill invocation(s): ${transform.unknownSlashSkills.join(", ")}`, "warning");
		}

		return { action: "transform", text, images: event.images };
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "read") return;

		const rawPath = typeof event.input.path === "string" ? event.input.path : undefined;
		if (!rawPath) return;

		const skillName = getSkillNameFromPath(rawPath, getSkills(pi));
		if (!skillName) return;

		await safeLogUsageEvent({
			ts: new Date().toISOString(),
			type: "auto-read",
			source: "tool_call",
			skills: [skillName],
			path: rawPath,
			toolCallId: event.toolCallId,
		});
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

			const items = getDollarSkillSuggestions(getSkills(pi), token);
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
	const token = getDollarTokenBeforeCursor(lines, cursor.line, cursor.col);
	if (!token) return false;

	return isDollarAutocompleteInput(data) || (data === "\t" && isCategoryFilterToken(token));
}

function isCategoryFilterToken(token: DollarToken): boolean {
	return Boolean(token.category && token.query.endsWith(":"));
}

function isDollarAutocompleteInput(data: string): boolean {
	return data === "$" || data === ":" || /^[a-zA-Z0-9-]$/.test(data);
}

function getDollarTokenBeforeCursor(lines: string[], cursorLine: number, cursorCol: number): DollarToken | null {
	const line = lines[cursorLine] ?? "";
	const beforeCursor = line.slice(0, cursorCol);
	const match = beforeCursor.match(DOLLAR_TOKEN_PATTERN);
	if (!match) return null;

	const query = match[1] ?? "";
	const separatorIndex = query.indexOf(":");
	if (separatorIndex === -1) {
		return { prefix: `$${query}`, query };
	}

	const categoryKey = query.slice(0, separatorIndex);
	const category = findCategory(categoryKey);
	return {
		prefix: `$${query}`,
		query,
		...(category ? { category } : {}),
		categoryQuery: query.slice(separatorIndex + 1),
	};
}

function getDollarSkillSuggestions(skills: SkillInfo[], token: DollarToken): AutocompleteItem[] {
	if (token.category) {
		return skillsToAutocompleteItems(filterSkills(getCategorySkills(skills, token.category), token.categoryQuery ?? ""));
	}

	if (token.query.includes(":")) return [];

	if (!token.query) {
		return uniqueAutocompleteItems([...categoriesToAutocompleteItems(skills, ""), ...skillsToAutocompleteItems(skills)]);
	}

	const category = findCategory(token.query);
	const directSkillItems = skillsToAutocompleteItems(filterSkills(skills, token.query));
	if (category) {
		const categorySkillItems = skillsToAutocompleteItems(getCategorySkills(skills, category));
		return uniqueAutocompleteItems([...categorySkillItems, ...directSkillItems]);
	}

	const categoryMatches = filterCategories(token.query);
	if (token.query && categoryMatches.length === 1) {
		const [matchedCategory] = categoryMatches;
		const categorySkillItems = skillsToAutocompleteItems(getCategorySkills(skills, matchedCategory));
		const categoryItems = categoriesToAutocompleteItems(skills, token.query);
		return uniqueAutocompleteItems([...categorySkillItems, ...directSkillItems, ...categoryItems]);
	}

	const categoryItems = categoriesToAutocompleteItems(skills, token.query);
	return uniqueAutocompleteItems([...categoryItems, ...directSkillItems]);
}

function skillsToAutocompleteItems(skills: SkillInfo[]): AutocompleteItem[] {
	return skills.map((skill) => ({
		value: `$${skill.name}`,
		label: `$${skill.name}`,
		...(skill.description ? { description: skill.description } : {}),
	}));
}

function categoriesToAutocompleteItems(skills: SkillInfo[], query: string): AutocompleteItem[] {
	const installedNames = new Set(skills.map((skill) => skill.name));
	return filterCategories(query)
		.map((category) => {
			const count = getCategorySkillNames(category).filter((name) => installedNames.has(name)).length;
			return {
				value: `$${category.id}:`,
				label: `$${category.id}:`,
				description: `${category.description}${count > 0 ? ` · ${count} skills` : ""}`,
			};
		})
		.filter((item) => categoryHasInstalledSkills(item.value.slice(1, -1), installedNames));
}

function filterCategories(query: string): SkillCategory[] {
	const normalized = query.toLowerCase();
	const categories = getSkillCategories();
	if (!normalized) return categories;
	return categories.filter((category) =>
		[category.id, ...category.aliases].some((value) => value.startsWith(normalized) || value.includes(normalized)),
	);
}

function findCategory(idOrAlias: string): SkillCategory | undefined {
	const normalized = idOrAlias.toLowerCase();
	return getSkillCategories().find((category) => category.id === normalized || category.aliases.includes(normalized));
}

function getCategorySkills(skills: SkillInfo[], category: SkillCategory): SkillInfo[] {
	if (category.id === "all") return skills;
	const names = new Set(getCategorySkillNames(category));
	return skills.filter((skill) => names.has(skill.name));
}

function getCategorySkillNames(category: SkillCategory): string[] {
	return category.id === "all" ? [] : category.skills;
}

function categoryHasInstalledSkills(categoryId: string, installedNames: Set<string>): boolean {
	const category = findCategory(categoryId);
	if (!category) return false;
	if (category.id === "all") return installedNames.size > 0;
	return category.skills.some((name) => installedNames.has(name));
}

function uniqueAutocompleteItems(items: AutocompleteItem[]): AutocompleteItem[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.value)) return false;
		seen.add(item.value);
		return true;
	});
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
	const suffix = item.value.endsWith(":") ? "" : afterCursor.length === 0 || !/^\s/.test(afterCursor) ? " " : "";
	const newLines = [...lines];
	newLines[cursorLine] = `${beforePrefix}${item.value}${suffix}${afterCursor}`;

	return {
		lines: newLines,
		cursorLine,
		cursorCol: beforePrefix.length + item.value.length + suffix.length,
	};
}

async function expandSkillMarkers(text: string, skillsByName: Map<string, SkillInfo>): Promise<SkillTransform | null> {
	const markers = findSkillMarkers(text);
	if (markers.length === 0) return null;

	const knownMarkers = markers.filter((marker) => skillsByName.has(marker.name));
	const orderedSkills = uniqueByName(knownMarkers)
		.map((marker) => skillsByName.get(marker.name))
		.filter((skill): skill is SkillInfo => Boolean(skill));
	if (orderedSkills.length === 0) return null;

	const skillBlock = await readCombinedSkillBlock(orderedSkills);
	const userMessage = removeKnownSkillMarkers(text, skillsByName).trim();
	const expandedText = userMessage ? `${skillBlock}\n\n${userMessage}` : skillBlock;

	return {
		text: normalizeBlankLines(expandedText),
		unknownSlashSkills: findUnknownSlashSkills(markers, skillsByName),
		knownMarkers,
		orderedSkills,
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

async function safeLogUsageEvent(event: UsageEvent): Promise<void> {
	try {
		await mkdir(HELPER_DIR, { recursive: true });
		await appendFile(USAGE_LOG_PATH, `${JSON.stringify(event)}\n`, "utf-8");
	} catch {
		// Usage logging is advisory. Never block input expansion or tool execution.
	}
}

function getSkillNameFromPath(rawPath: string, skills: SkillInfo[]): string | null {
	if (!rawPath.endsWith("/SKILL.md") && rawPath !== "SKILL.md") return null;

	const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
	const normalizedPath = resolve(absolutePath);
	const skill = skills.find((candidate) => resolve(candidate.path) === normalizedPath);
	return skill?.name ?? null;
}

async function createSkillHelperReportAndCleanup(skills: SkillInfo[]): Promise<{ report: string; cleanup: UsageCleanupResult }> {
	const [events, catalog] = await Promise.all([readUsageEvents(), collectSkillCatalogStats(skills)]);
	const report = formatSkillHelperReport(catalog, events);
	const cleanup = await rotateUsageLogIfNeeded();
	return { report, cleanup };
}

async function collectSkillCatalogStats(skills: SkillInfo[]): Promise<SkillCatalogStats> {
	const config = readCatalogConfig();
	const categories = config.categories.length > 0 ? config.categories : getSkillCategories();
	const installedNames = new Set(skills.map((skill) => skill.name));
	const categorySkillNames = new Set(categories.flatMap((category) => (category.id === "all" ? [] : category.skills)));
	const disableModelInvocation = await getDisableModelInvocationNames(skills);
	const userOnlySkills = [...new Set([...config.manualOnly, ...disableModelInvocation])]
		.filter((name) => installedNames.has(name))
		.sort();

	return {
		totalSkills: skills.length,
		categoryCount: categories.length,
		categorizedSkills: skills.filter((skill) => categorySkillNames.has(skill.name)).length,
		uncategorizedSkills: skills.map((skill) => skill.name).filter((name) => !categorySkillNames.has(name)).sort(),
		llmVisibleSkills: skills.length - userOnlySkills.length,
		userOnlySkills,
		manualOnlyMissing: config.manualOnly.filter((name) => !installedNames.has(name)).sort(),
		categoryRows: categories.map((category) => ({
			id: category.id,
			count: category.id === "all" ? skills.length : category.skills.filter((name) => installedNames.has(name)).length,
		})),
	};
}

function readCatalogConfig(): { manualOnly: string[]; categories: SkillCategory[] } {
	try {
		const parsed = JSON.parse(readFileSync(CATALOG_PATH, "utf-8")) as { manualOnly?: string[]; categories?: SkillCategory[] };
		return {
			manualOnly: Array.isArray(parsed.manualOnly) ? parsed.manualOnly : [],
			categories: Array.isArray(parsed.categories) ? parsed.categories : [],
		};
	} catch {
		return { manualOnly: [], categories: DEFAULT_SKILL_CATEGORIES };
	}
}

async function getDisableModelInvocationNames(skills: SkillInfo[]): Promise<string[]> {
	const names = await Promise.all(
		skills.map(async (skill) => {
			try {
				const content = await readFile(skill.path, "utf-8");
				return /^disable-model-invocation:\s*true\s*$/m.test(content) ? skill.name : null;
			} catch {
				return null;
			}
		}),
	);
	return names.filter((name): name is string => Boolean(name));
}

async function readUsageEvents(): Promise<UsageEvent[]> {
	const files = await listUsageFiles();
	const events: UsageEvent[] = [];
	for (const file of files) {
		let text = "";
		try {
			text = await readFile(join(HELPER_DIR, file), "utf-8");
		} catch {
			continue;
		}

		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as UsageEvent;
				if (Array.isArray(parsed.skills) && parsed.type && parsed.ts) events.push(parsed);
			} catch {
				// Ignore partial/corrupt lines. Usage logs are advisory.
			}
		}
	}
	return events;
}

async function listUsageFiles(): Promise<string[]> {
	let files: string[] = [];
	try {
		files = await readdir(HELPER_DIR);
	} catch {
		return [];
	}

	return files
		.filter((file) => file === "usage.jsonl" || /^usage\.jsonl\.\d+$/.test(file))
		.sort((a, b) => usageFileRank(a) - usageFileRank(b));
}

function usageFileRank(file: string): number {
	if (file === "usage.jsonl") return 0;
	const match = file.match(/\.(\d+)$/);
	return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function formatSkillHelperReport(catalog: SkillCatalogStats, events: UsageEvent[]): string {
	const explicit = events.filter((event) => event.type === "explicit");
	const autoRead = events.filter((event) => event.type === "auto-read");
	const allSkills = new Set<string>();
	for (const event of events) for (const skill of event.skills) allSkills.add(skill);

	const lines = [
		"# Skill Helper Report",
		"",
		"## Snapshot",
		`- installed skills: ${catalog.totalSkills}`,
		`- categories: ${catalog.categoryCount}`,
		`- categorized: ${catalog.categorizedSkills}/${catalog.totalSkills}`,
		`- LLM-visible: ${catalog.llmVisibleSkills}`,
		`- user-only / LLM-hidden: ${catalog.userOnlySkills.length}`,
		`- usage events: ${events.length} (${explicit.length} user, ${autoRead.length} model)`,
		`- usage window: ${formatUsageWindow(events)}`,
		"",
		"## Categories",
		...catalog.categoryRows.map((row) => `- ${row.id}: ${row.count}`),
		"",
		"## User-only / LLM-hidden skills",
		...formatNameList(catalog.userOnlySkills),
		"",
		"## Needs attention",
		...formatAttentionList(catalog),
		"",
		"## Usage top",
		`- user-called: ${formatInlineTopSkillCounts(explicit)}`,
		`- model-used: ${formatInlineTopSkillCounts(autoRead)}`,
	];

	return lines.join("\n");
}

function formatUsageWindow(events: UsageEvent[]): string {
	const timestamps = events.map((event) => Date.parse(event.ts)).filter(Number.isFinite).sort((a, b) => a - b);
	if (timestamps.length === 0) return "none";
	return `${new Date(timestamps[0]).toISOString()} → ${new Date(timestamps[timestamps.length - 1]).toISOString()}`;
}

function formatInlineTopSkillCounts(events: UsageEvent[]): string {
	const counts = new Map<string, number>();
	for (const event of events) {
		for (const skill of event.skills) counts.set(skill, (counts.get(skill) ?? 0) + 1);
	}

	const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
	return top.length > 0 ? top.map(([skill, count]) => `${skill} ${count}`).join(", ") : "none";
}

function formatNameList(names: string[]): string[] {
	if (names.length === 0) return ["- none"];
	const lineLength = 100;
	const lines: string[] = [];
	let current = "";
	for (const name of names) {
		const next = current ? `${current}, ${name}` : name;
		if (next.length > lineLength && current) {
			lines.push(`- ${current}`);
			current = name;
		} else {
			current = next;
		}
	}
	if (current) lines.push(`- ${current}`);
	return lines;
}

function formatAttentionList(catalog: SkillCatalogStats): string[] {
	const attention: string[] = [];
	if (catalog.uncategorizedSkills.length > 0) attention.push(`- uncategorized: ${catalog.uncategorizedSkills.join(", ")}`);
	if (catalog.manualOnlyMissing.length > 0) attention.push(`- manualOnly missing: ${catalog.manualOnlyMissing.join(", ")}`);
	return attention.length > 0 ? attention : ["- none"];
}

function formatRecentEvents(events: UsageEvent[]): string[] {
	const recent = [...events]
		.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
		.slice(0, 10)
		.map((event) => `- ${event.ts} ${event.type}: ${event.skills.join(", ")}`);
	return recent.length > 0 ? recent : ["- none"];
}

async function rotateUsageLogIfNeeded(): Promise<UsageCleanupResult> {
	const maxBytes = readPositiveNumberFromEnv("PI_SKILL_USAGE_MAX_MB", DEFAULT_USAGE_MAX_BYTES / 1024 / 1024) * 1024 * 1024;
	const keep = Math.max(1, Math.floor(readPositiveNumberFromEnv("PI_SKILL_USAGE_KEEP", DEFAULT_USAGE_KEEP)));
	let sizeBytes = 0;
	try {
		sizeBytes = (await stat(USAGE_LOG_PATH)).size;
	} catch {
		return { rotated: false, maxBytes, keep, sizeBytes, message: "no active log" };
	}

	if (sizeBytes <= maxBytes) {
		return { rotated: false, maxBytes, keep, sizeBytes, message: `active log ${formatBytes(sizeBytes)} ≤ ${formatBytes(maxBytes)}` };
	}

	await rm(`${USAGE_LOG_PATH}.${keep}`, { force: true });
	for (let index = keep - 1; index >= 1; index -= 1) {
		try {
			await rename(`${USAGE_LOG_PATH}.${index}`, `${USAGE_LOG_PATH}.${index + 1}`);
		} catch {
			// Missing older rotations are fine.
		}
	}
	await rename(USAGE_LOG_PATH, `${USAGE_LOG_PATH}.1`);

	return { rotated: true, maxBytes, keep, sizeBytes, message: `rotated ${formatBytes(sizeBytes)} log; keeping ${keep} files` };
}

function readPositiveNumberFromEnv(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function appendSkillHelperReport(text: string, report: string, cleanup: UsageCleanupResult): string {
	return normalizeBlankLines(`${text}\n\n<skill-helper-report>\n${report}\n\n## Cleanup\n- ${cleanup.message}\n- max active log: ${formatBytes(cleanup.maxBytes)}\n- rotated files kept: ${cleanup.keep}\n</skill-helper-report>`);
}
