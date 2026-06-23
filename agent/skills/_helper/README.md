# Pi Skills

Local skill library for pi.

Use this file as the top-level catalog when asking “what skills exist?” or “which skill should I use?”.

## Layout policy

- Vendored upstream skills: `agent/skills/<upstream-owner>/...`
  - Preserve upstream skill folder names.
  - Preserve upstream category folders only when upstream uses them.
  - Keep a source-level `README.md` with repo, commit, license, installed subset, update rule.
- Local/custom skills: `agent/skills/custom/...`
  - Hand-authored or adapted workflows with no clean upstream sync target.
- Avoid duplicating the same `name:` across sources.
- Keep imported subsets small; every skill description competes for startup context.

## Vendored sources

| Source | Upstream | Installed scope |
| --- | --- | --- |
| `dietrich-gebert/` | DietrichGebert/ponytail | all upstream `skills/*`, flat mirror |
| `mattpocock/` | mattpocock/skills | active `engineering/` + `productivity/` groups |
| `julius-brussee/` | JuliusBrussee/caveman | `skills/caveman` only |
| `zarazhangrui/` | zarazhangrui/frontend-slides | `frontend-slides` skill |
| `chequer-skills` | chequer-io/skills | symlink to `/Users/kelly/w/skills/skills`, loaded via `settings.json` `skills` |

## Custom/local

| Path | Notes |
| --- | --- |
| `custom/critical-ai-partner/` | local engineering judgment partner |
| `custom/fable5/` | curated workflows extracted/adapted from Fable-style prompts |
| `custom/workspace/` | local git worktree workflow |
| `custom/skill-helper/` | skill helper: categories, manual-only policy, validation |

## `$` skill picker

The local `inline-skill` extension makes `$` invoke skills inline.

Categories are configured in `agent/skills/_helper/categories.json`. The picker uses **short task words**, not upstream repo names. `$ponytail:` and `$matt:` are intentionally not categories. Use `$mode:` for `ponytail`; use the task category for Matt skills.

| Category | Aliases | Meaning | Examples |
| --- | --- | --- | --- |
| `$plan:` | `$design:`, `$arch:`, `$prd:` | Think before work: design, domain, PRD, issues, triage, handoff. | `codebase-design`, `domain-modeling`, `frontend-project-init`, `self-hosted-runner-labels` |
| `$code:` | `$build:`, `$dev:` | Make code changes: implement, TDD, prototype, worktree, conflict fix. | `workspace`, `tdd`, `frontend-project-init`, `frontend-review` |
| `$debug:` | `$fix:`, `$bug:` | Diagnose broken/failing/slow behavior. | `diagnosing-bugs`, `querypie-runner-access`, `querypie-seamless-ssh` |
| `$review:` | `$check:`, `$audit:`, `$release:` | Judge existing work: code review, release check, simplification audit. | `code-review-checklist`, `release-validation`, `frontend-review`, `self-hosted-runner-labels` |
| `$research:` | `$docs:`, `$web:`, `$verify:` | Look things up: web/docs/source-backed facts, product behavior, safe summaries. | `research-with-sources`, `product-docs-verifier`, `find-querypie-wiki-content` |
| `$artifact:` | `$make:`, `$file:`, `$html:`, `$slides:` | Produce deliverables: files, HTML artifacts, demos, dashboards, slide decks. | `file-deliverable-router`, `artifact-html-builder`, `frontend-slides` |
| `$mode:` | `$talk:`, `$meta:`, `$skill:` | Change working style or meta-flow: terse replies, YAGNI mode, teaching, skill help. | `caveman`, `ponytail`, `discover-skill`, `sync-querypie-wiki-skill` |
| `$all:` | `$everything:` | Escape hatch: show every installed skill. | all skills |

Usage:

- Type `$` → category suggestions + all skills.
- Type a partial category with one clear match → that category's skills first, e.g. `$p`/`$pla` shows plan skills.
- Type an exact category → that category's skills, e.g. `$review` shows review skills; `$all` shows every skill.
- Type category + `:` → filter inside that category, e.g. `$review:p` → `ponytail-review`, `ponytail-audit`, `ponytail-debt`.
- Type skill name directly → direct lookup, e.g. `$tdd`, `$ponytail`, `$frontend-slides`.
- Category aliases also work, e.g. `$fix`/`$fix:` → debug skills, `$docs`/`$docs:` → research skills.
- Submitted `$skill-name` expands that skill inline.
- Submitted `$skill-helper` also injects a compact helper report: inventory, categories, LLM visibility, usage, and log cleanup.

## Skill helper maintenance

Use one command:

```text
$skill-helper 스킬 정리해줘
```

Default full pass:

1. **Discover**
   - Inspect `agent/skills/**/SKILL.md`.
   - Check duplicate names, uncategorized skills, and current `manualOnly` state.
   - Review the injected `<skill-helper-report>` from `$skill-helper`, or run `node agent/skills/_helper/usage-report.mjs`.
   - Check `git status --short agent/skills agent/extensions/inline-skill.ts`.
2. **Update vendored skills**
   - Read each source README under `agent/skills/<owner>/README.md`.
   - Clone/fetch upstream to temp dirs.
   - Re-sync only the documented installed subset.
   - Preserve upstream layout and intentional excludes.
   - Update source README commit/date/license notes.
3. **Categorize**
   - Add every skill to `agent/skills/_helper/categories.json`.
   - Keep category names short: `plan`, `code`, `debug`, `review`, `research`, `artifact`, `mode`, `all`.
4. **Set visibility**
   - Decide which skills LLM should auto-see.
   - Put user-invoked-only skills in `manualOnly`.
   - Apply `disable-model-invocation: true` using validator fix mode.
5. **Validate**
   ```bash
   node agent/skills/_helper/validate-catalog.mjs --fix
   node agent/skills/_helper/validate-catalog.mjs
   ```
6. **Build-check picker**
   ```bash
   npx -y -p esbuild esbuild agent/extensions/inline-skill.ts \
     --bundle --platform=node --format=esm \
     --external:@earendil-works/pi-coding-agent \
     --external:@earendil-works/pi-tui \
     --outfile=/tmp/inline-skill.js
   ```
7. **Report**
   - Upstream commits checked/synced.
   - Added/removed/changed skills.
   - Category changes.
   - `manualOnly` / frontmatter changes.
   - Validation result.
   - Remind: `/reload`.

Usage tracking:

- `agent/extensions/inline-skill.ts` logs explicit `$skill`, `/skill:name`, and model `read .../SKILL.md` usage.
- `externalSkills` in `categories.json` lists installed package skills outside `agent/skills/` that should still count as categorized.
- Active log: `agent/skills/_helper/usage.jsonl`.
- Default size policy: 5MB active log, 10 rotated files.
- Overrides: `PI_SKILL_USAGE_MAX_MB`, `PI_SKILL_USAGE_KEEP`.
- `node agent/skills/_helper/usage-report.mjs` reports usage, scans past sessions by default, then rotates if needed.
- Use `--no-sessions`, `--no-cleanup`, `--max-mb=5`, `--keep=10` for script control.

For a narrower task, say it explicitly:

```text
$skill-helper 새로 추가한 스킬만 정리해줘
$skill-helper upstream 업데이트만 해줘
$skill-helper manualOnly만 점검해줘
```

## Quick pick

| Need | Use |
| --- | --- |
| Minimal/YAGNI implementation | `ponytail` |
| Very terse replies | `caveman` |
| Diagnose a bug/perf regression | `diagnosing-bugs` |
| Test-first implementation | `tdd` |
| Normal code review | `code-review-checklist` |
| Over-engineering review only | `ponytail-review` |
| Whole-repo complexity audit | `ponytail-audit` |
| Pre-PR/pre-release validation | `release-validation` |
| Current facts or web/docs research | `research-with-sources` |
| pi/SDK/API/model docs verification | `product-docs-verifier` |
| New branch/worktree | `workspace` |
| Standalone HTML artifact | `artifact-html-builder` |
| HTML slide deck / PPTX conversion | `frontend-slides` |
| Plan/design grilling | `grilling`, `grill-me`, `grill-with-docs` |
| Domain model / ADR language | `domain-modeling`, `codebase-design` |
| PRD/issues/triage | `to-prd`, `to-issues`, `triage` |
| Handoff | `handoff` |
| Skill authoring | `writing-great-skills` |
| QueryPie wiki lookup | `find-querypie-wiki-content` |
| QueryPie wiki update PR | `update-querypie-wiki-content` |
| Self-hosted runner label choice | `self-hosted-runner-labels` |
| Self-hosted runner host access/check | `querypie-runner-access`, `querypie-seamless-ssh` |
| Frontend project scaffolding | `frontend-project-init` |
| Frontend review rules | `frontend-review` |

## Invocation policy

Some skills are best explicitly invoked by the user; others are safe for the agent to auto-select from the task description.

Frontmatter flags:

- `disable-model-invocation: true` — user-invoked only. Hide from model auto-selection/listing; use for large, interactive, stateful, or side-effect-prone workflows.
- `user-invocable: false` — Claude Code flag for model-only skills hidden from slash menu. Pi docs do not currently document this flag; use only when targeting Claude Code too.
- No flag — model can auto-select from `description`, and user can still invoke directly.

| Mode | Meaning | Skills |
| --- | --- | --- |
| Explicit/user-invoked | Use when the user deliberately asks for that workflow or runs `/skill-name`. These currently have `disable-model-invocation: true` upstream. | `ask-matt`, `grill-with-docs`, `implement`, `improve-codebase-architecture`, `prototype`, `setup-matt-pocock-skills`, `to-issues`, `to-prd`, `triage`, `grill-me`, `handoff`, `teach`, `writing-great-skills` |
| Auto-select OK | Let the agent load when the request clearly matches the description. User can still invoke directly. | all other skills |

Rule of thumb:

- Say `/skill-name` when you want that exact workflow.
- Just describe the task when you want the agent to choose.
- Use explicit invocation for workflows that write docs/issues, grill/interview you, make prototypes, or continue from a PRD.

## Full catalog

### Custom

| Skill | Path | Use when |
| --- | --- | --- |
| `critical-ai-partner` | `custom/critical-ai-partner/` | Engineering help needing pushback on ambiguity, design risk, validation, or simpler alternatives. |
| `artifact-html-builder` | `custom/fable5/artifacts/artifact-html-builder/` | Interactive demo, visual prototype, standalone web page, browser artifact, dashboard, animation, rich single-file UI. |
| `copyright-safe-summary` | `custom/fable5/content/copyright-safe-summary/` | Summarizing/discussing third-party articles, books, transcripts, lyrics, poems, long docs. |
| `file-deliverable-router` | `custom/fable5/deliverables/file-deliverable-router/` | Decide inline answer vs saved file/export for docs, reports, scripts, HTML, spreadsheets, slides. |
| `code-review-checklist` | `custom/fable5/engineering/code-review-checklist/` | Review/audit/inspect/critique diffs, PRs, staged changes, commits, or files. |
| `release-validation` | `custom/fable5/engineering/release-validation/` | Pre-PR, pre-merge, pre-release, final validation. |
| `product-docs-verifier` | `custom/fable5/product/product-docs-verifier/` | Verify pi, Claude/Anthropic, SDK, API, model, pricing, limits, tool behavior against docs. |
| `research-with-sources` | `custom/fable5/research/research-with-sources/` | Current facts, product/API details, comparisons, rankings, market/news research. |
| `workspace` | `custom/workspace/` | Set up date-prefixed feature branch and git worktree. |

### DietrichGebert / ponytail

| Skill | Path | Use when |
| --- | --- | --- |
| `ponytail` | `dietrich-gebert/ponytail/` | Simplest working solution, YAGNI, stdlib/native-first, minimal diff. |
| `ponytail-review` | `dietrich-gebert/ponytail-review/` | Diff/code review focused only on over-engineering and what to delete. |
| `ponytail-audit` | `dietrich-gebert/ponytail-audit/` | Whole-repo audit for over-engineering, bloat, removable abstractions/deps. |
| `ponytail-debt` | `dietrich-gebert/ponytail-debt/` | Collect `ponytail:` comments into a debt ledger. |
| `ponytail-gain` | `dietrich-gebert/ponytail-gain/` | Show ponytail benchmark impact scoreboard. |
| `ponytail-help` | `dietrich-gebert/ponytail-help/` | Show ponytail command/help card. |

### JuliusBrussee / caveman

| Skill | Path | Use when |
| --- | --- | --- |
| `caveman` | `julius-brussee/caveman/` | Ultra-compressed replies; “less tokens”, “be brief”, `/caveman`. |

### Matt Pocock

| Skill | Path | Use when |
| --- | --- | --- |
| `ask-matt` | `mattpocock/engineering/ask-matt/` | Router for which Matt Pocock skill/flow fits. |
| `codebase-design` | `mattpocock/engineering/codebase-design/` | Design/improve module interfaces, seams, deep modules, testability. |
| `diagnosing-bugs` | `mattpocock/engineering/diagnosing-bugs/` | Debug/diagnose broken, throwing, failing, slow behavior. |
| `domain-modeling` | `mattpocock/engineering/domain-modeling/` | Pin down domain terminology, ubiquitous language, ADR decisions. |
| `grill-with-docs` | `mattpocock/engineering/grill-with-docs/` | Stress-test plan/design while updating domain docs/ADRs. |
| `implement` | `mattpocock/engineering/implement/` | Implement work from a PRD or set of issues. |
| `improve-codebase-architecture` | `mattpocock/engineering/improve-codebase-architecture/` | Scan codebase for architecture deepening opportunities. |
| `prototype` | `mattpocock/engineering/prototype/` | Throwaway prototype for business logic/state/UI variations. |
| `resolving-merge-conflicts` | `mattpocock/engineering/resolving-merge-conflicts/` | Resolve in-progress git merge/rebase conflicts. |
| `setup-matt-pocock-skills` | `mattpocock/engineering/setup-matt-pocock-skills/` | Configure repo issue tracker, triage labels, domain docs for Matt skills. |
| `tdd` | `mattpocock/engineering/tdd/` | Test-driven development, red-green-refactor, integration tests. |
| `to-issues` | `mattpocock/engineering/to-issues/` | Break plan/spec/PRD into independently grabbable issue slices. |
| `to-prd` | `mattpocock/engineering/to-prd/` | Turn current conversation into a PRD. |
| `triage` | `mattpocock/engineering/triage/` | Move issues/PRs through triage state machine and write agent-ready briefs. |
| `grill-me` | `mattpocock/productivity/grill-me/` | Relentless interview to sharpen a plan/design. |
| `grilling` | `mattpocock/productivity/grilling/` | Auto-triggered plan/design grilling. |
| `handoff` | `mattpocock/productivity/handoff/` | Compact current conversation into a handoff for another agent/session. |
| `teach` | `mattpocock/productivity/teach/` | Teach a skill/concept using the current workspace. |
| `writing-great-skills` | `mattpocock/productivity/writing-great-skills/` | Reference for writing/editing predictable skills. |

### zarazhangrui

| Skill | Path | Use when |
| --- | --- | --- |
| `frontend-slides` | `zarazhangrui/frontend-slides/` | Create animation-rich HTML presentations or convert PPT/PPTX to web slides. |

### Chequer / QueryPie

Loaded from `/Users/kelly/.config/pi/agent/chequer-skills` → `/Users/kelly/w/skills/skills`.

| Skill | Path | Use when |
| --- | --- | --- |
| `discover-skill` | `chequer-skills/discover-skill/` | Discover QueryPie team skills and bundles. |
| `find-querypie-wiki-content` | `chequer-skills/find-querypie-wiki-content/` | Read-only lookup of QueryPie Wiki knowledge. |
| `update-querypie-wiki-content` | `chequer-skills/update-querypie-wiki-content/` | Add/update/deprecate QueryPie Wiki content through source-repo PR flow. |
| `sync-querypie-wiki-skill` | `chequer-skills/sync-querypie-wiki-skill/` | Refresh installed QueryPie Wiki-related skills. |
| `self-hosted-runner-labels` | `chequer-skills/self-hosted-runner-labels/` | Choose GitHub Actions self-hosted runner labels. |
| `querypie-seamless-ssh` | `chequer-skills/querypie-seamless-ssh/` | Use QueryPie Seamless SSH / `qpctl ssh-proxy` to reach internal hosts. |
| `querypie-runner-access` | `chequer-skills/querypie-runner-access/` | Safely inspect self-hosted runner hosts after QueryPie SSH access. |
| `frontend-project-init` | `chequer-skills/frontend-project-init/` | Frontend scaffolding stack and structure decisions. |
| `frontend-review` | `chequer-skills/frontend-review/` | Frontend code review rules for React/TypeScript/UI changes. |

## Reload

Existing pi session: run `/reload`.
New pi session: loaded automatically.
