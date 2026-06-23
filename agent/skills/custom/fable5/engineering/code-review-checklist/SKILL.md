---
name: code-review-checklist
description: Structured code review for diffs, PRs, staged changes, commits, or specific files, focused on bugs, security, maintainability, tests, and behavior preservation. Use when the user asks to review, audit, inspect, critique, or sanity-check code without directly implementing changes.
---

# Code Review Checklist

## Review Mode

Do not edit code unless explicitly asked. Review the relevant diff/files and report findings by severity.

## Workflow

1. Establish scope: PR URL, staged diff, branch diff, commit range, or named files.
2. Understand intended behavior from issue/spec/tests/docs when available.
3. Inspect changed code plus nearby call sites and types/interfaces.
4. Run focused static checks/tests only when cheap and useful.
5. Prioritize findings that can cause real defects.

## Checklist

- Correctness: edge cases, null/empty states, async/race issues, error paths, data loss.
- Behavior: backward compatibility, API contracts, migrations, config/default changes.
- Security: injection, authz/authn, secrets, path traversal, unsafe shell, SSRF, XSS, CSRF.
- Reliability: retries, timeouts, resource cleanup, idempotency, concurrency.
- Tests: missing regression tests, over-mocked tests, snapshot brittleness.
- Maintainability: duplication, unclear ownership, leaky abstraction, surprising coupling.
- Performance: obvious N+1, unbounded work, large memory use, blocking I/O.

## Output Shape

- If clean: say no blocking findings, then note minor risks if any.
- Findings format:
  - Severity: blocker/high/medium/low
  - File:line
  - Problem
  - Why it matters
  - Suggested fix
- Keep style concise. Avoid nitpicks unless user asks for polish.
