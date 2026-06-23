---
name: skill-helper
description: >
  Maintain local pi skills end-to-end: add/sync/update vendored skills from
  upstream, preserve mirror layout, categorize skills for the picker, update
  manual-only policy, validate duplicate names, and keep skill docs current.
  Use when adding, updating, syncing, removing, auditing, or reorganizing skills.
disable-model-invocation: true
---

# Skill Helper

Maintain `agent/skills/` end-to-end. If invoked without a narrower task, do a full skill maintenance pass: update vendored upstream skills, preserve mirror layout, categorize every skill, set manual-only policy, validate, and report.

## Files

- Skill helper config: `agent/skills/_helper/categories.json`
- Validator/fixer: `agent/skills/_helper/validate-catalog.mjs`
- Skill helper docs: `agent/skills/_helper/README.md`
- Usage report: `agent/skills/_helper/usage-report.mjs`
- Runtime usage log: `agent/skills/_helper/usage.jsonl` (ignored, rotates at 5MB by default)
- Picker extension: `agent/extensions/inline-skill.ts`

## Default invocation

If the user invokes `$skill-helper` with no extra detail, run the full maintenance pass. Do not ask what to do unless the repo state is unsafe or upstream/update scope is ambiguous.

Common user prompts:

- `$skill-helper 스킬 정리해줘` → full pass.
- `$skill-helper 새로 추가한 스킬만 정리해줘` → categorize/visibility/validate only.
- `$skill-helper upstream 업데이트만 해줘` → update vendored sources, then validate.
- `$skill-helper manualOnly만 점검해줘` → visibility/frontmatter pass only.

## Workflow

1. Discover current state.
   - Run `git status --short agent/skills agent/extensions/inline-skill.ts`.
   - Review the injected `<skill-helper-report>` if `$skill-helper` was used.
   - For a fresh CLI report, run `node agent/skills/_helper/usage-report.mjs`.
   - Do not touch unrelated user changes outside skill/helper files.
2. Update vendored upstream skills when requested or when doing a full maintenance pass.
   - Read each source README under `agent/skills/<upstream-owner>/README.md` for repo, commit, installed subset, excludes, and update rule.
   - Clone/fetch upstream to a temp dir.
   - Re-sync only the installed subset documented in the source README.
   - Preserve upstream layout exactly; do not invent category folders inside vendored sources.
   - Update source README commit/date/license notes.
3. Preserve local/custom skills.
   - Local skills live under `agent/skills/custom/...`.
   - Do not overwrite local skills from upstream unless the user explicitly says they are vendored.
4. Run validation:
   ```bash
   node agent/skills/_helper/validate-catalog.mjs
   ```
5. Categorize every new skill in `categories.json`.
   - Put package/external skills that live outside `agent/skills/` in `externalSkills` before referencing them from categories.
   - `plan`: design, PRD, issues, triage, handoff.
   - `code`: implement, TDD, prototype, worktree, conflicts.
   - `debug`: bugs, failures, slow behavior.
   - `review`: code review, release check, audit, simplification.
   - `research`: web/docs/source-backed facts, product behavior, summaries.
   - `artifact`: files, HTML artifacts, demos, slides.
   - `mode`: answer style, YAGNI mode, teaching, skill help.
6. Update `manualOnly` in `categories.json` for skills the model should not auto-select.
   - Add large, interactive, stateful, setup, command/help, or side-effect-prone workflows.
   - Keep small task-matching skills auto-visible when model selection helps.
7. Apply frontmatter policy if needed:
   ```bash
   node agent/skills/_helper/validate-catalog.mjs --fix
   ```
   This adds/updates `disable-model-invocation: true` for names in `manualOnly`.
8. Update docs.
   - Update `agent/skills/_helper/README.md` if categories, updater behavior, usage tracking, or user-facing picker behavior changed.
   - Update source-level README files when upstream commits change.
9. Validate picker build:
   ```bash
   npx -y -p esbuild esbuild agent/extensions/inline-skill.ts \
     --bundle --platform=node --format=esm \
     --external:@earendil-works/pi-coding-agent \
     --external:@earendil-works/pi-tui \
     --outfile=/tmp/inline-skill.js
   ```
10. Tell user to run `/reload`.

## Update rule

Vendored skill update means:

- preserve source folder name (`agent/skills/<owner>/...`)
- preserve upstream skill folder names
- copy only the installed subset
- keep excludes intentional (for example deprecated/in-progress folders)
- keep license files
- update source README with upstream commit/date
- re-run catalog validation after sync

If upstream changes introduce new skill names, add them to `categories.json` and decide `manualOnly` before reporting done.

## Usage tracking

`$skill-helper` invocation gets a compact helper report injected automatically by `agent/extensions/inline-skill.ts`: inventory, categories, LLM visibility, usage, and log cleanup.

Tracked usage:

- explicit `$skill` and `/skill:name` calls
- model `read .../SKILL.md` auto-use
- past session scan via `node agent/skills/_helper/usage-report.mjs`

Runtime logs are ignored by git:

- active log: `agent/skills/_helper/usage.jsonl`
- default active size cap: 5MB
- default rotated files kept: 10
- override with `PI_SKILL_USAGE_MAX_MB` and `PI_SKILL_USAGE_KEEP`

The report is generated before cleanup. If `usage.jsonl` exceeds the size cap, it rotates afterward (`usage.jsonl.1`, `.2`, ...).

## Manual-only rule

Use `disable-model-invocation: true` when automatic model use is undesirable but user invocation should remain available via `$skill` or `/skill:name`.

Good manual-only candidates:

- setup/install/config workflows
- publish/deploy/commit/send workflows
- repo-wide audits
- help/scoreboard one-shots
- long interactive interviews
- workflows that create external issues/docs from conversation state

Do not mark a skill manual-only just because it is large. If the user's natural request should trigger it automatically, leave it visible.

## Output

Report:

- upstream sources checked and commits synced
- added/removed/changed skills
- category changes
- manualOnly/frontmatter changes
- validation result
- `/reload` reminder
