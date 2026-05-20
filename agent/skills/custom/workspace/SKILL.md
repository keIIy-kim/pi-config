---
name: workspace
description: Set up a date-prefixed feature branch and worktree from the latest main branch. Use when preparing an isolated workspace before implementation or when the user asks to split work into a worktree/branch.
version: 1
created: 2026-05-16
updated: 2026-05-16
---
# Workspace

## Quick start

Prepare an isolated implementation workspace from the latest main/default branch.

Naming rule:

- Branch and worktree name: `YYMMDD-<feature-slug>`
- Example for 2026-05-16: `260516-contact-resource`

## Workflow

1. Find repo root and default branch.
   - Prefer `origin/HEAD`.
   - If ambiguous, ask the user.
2. Check current worktree safety.
   - Run `git status --short`.
   - Do not stash, reset, clean, or move user changes without explicit permission.
3. Update main/default branch.
   - Checkout the default branch.
   - `git fetch origin`
   - Fast-forward only: `git pull --ff-only`
4. Create the dated feature branch/worktree from updated main.
   - Use a clear feature slug.
   - Recommended path: sibling worktree directory, e.g. `../<repo>-worktrees/<branch-name>`.
   - Command shape: `git worktree add <path> -b <branch-name> <main-branch>`.
5. Continue all implementation commands inside the new worktree.
6. Report setup to the user before coding:
   - Worktree path
   - Branch name
   - Base branch/commit

## Guardrails

- Do not use this if the user says not to split worktrees or branches.
- Do not mutate unrelated dirty changes in the original worktree.
- Do not use vague names like `feature/work`, `tmp`, or `test`.
- Do not force-pull or reset main unless explicitly asked.

## Verification

Run:

```bash
git worktree list
git -C <worktree-path> branch --show-current
git -C <worktree-path> status --short
```

Expected:

- New worktree exists.
- Current branch is the `YYMMDD-<feature-slug>` branch.
- New worktree is clean.
- User has been told the path and branch.