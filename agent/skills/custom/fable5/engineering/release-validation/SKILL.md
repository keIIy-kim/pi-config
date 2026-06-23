---
name: release-validation
description: Pre-PR, pre-merge, or pre-release validation workflow that checks diffs, tests, docs, changelog, packaging, and residual risks. Use when the user asks to prepare for release, final check, validate before shipping, review staged changes, or ensure work is done.
---

# Release Validation

## Trigger

Use before shipping, merging, tagging, publishing, deploying, or handing off completed implementation.

## Workflow

1. Inspect git state: changed files, staged files, branch, recent commits if relevant.
2. Compare changes against the user's explicit requirements.
3. Run focused validation first, then broader validation if cheap:
   - unit/regression tests for touched area
   - typecheck/lint/build when relevant
   - package-specific checks from README/AGENTS/docs
4. Check docs/changelog/migrations/config updates when behavior or API changed.
5. Review diff for accidental files, secrets, generated noise, debug logs, TODOs.
6. Summarize evidence and blockers.

## Done Criteria

- Requirements satisfied or gaps called out.
- Tests/checks run and results reported.
- Changed files intentional.
- No unresolved diagnostics in edited source files when LSP/checks are available.
- Residual risks explicit.

## Output Shape

- Status: ready / not ready.
- Changed files summary.
- Validation commands + pass/fail.
- Blocking issues if any.
- Residual risks / follow-ups.

## Guardrails

- Do not claim ready if tests fail or validation was skipped without reason.
- Do not hide partial implementation.
- Do not perform destructive cleanup, commits, tags, or publishing without explicit user request.
