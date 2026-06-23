---
name: file-deliverable-router
description: Decide whether a user request should be answered inline or produced as a file, and choose the right deliverable format. Use when the user asks to write, create, save, download, draft, export, generate, or modify a standalone document, report, script, HTML page, spreadsheet, slide deck, or other file.
---

# File Deliverable Router

## Decision

Create a file when the user asks for a standalone artifact they will keep, share, run, edit, or upload.

Answer inline when the user asks for advice, explanation, summary, strategy, plan, review, or brainstorming and does not request a saved artifact.

## Format Routing

- Code/script/module/component → source file in repo or requested path.
- Markdown → general written artifact, notes, README, lightweight report.
- HTML → standalone interactive/static browser artifact.
- docx → only when user asks for Word/professional document deliverable.
- pptx/slides → slide deck/presentation request.
- xlsx/csv → spreadsheet/table deliverable or data cleaning output.
- pdf → when user explicitly asks for PDF or PDF manipulation.

## Workflow

1. Confirm target path/format only if unclear and it affects correctness.
2. Inspect existing files/templates when modifying or matching style.
3. Create in the requested location; otherwise use a clear project path.
4. For generated code/files, run the smallest useful validation.
5. Report path, what changed, validation, and any residual risk.

## Guardrails

- Do not dump long artifacts into chat when a file was requested.
- Do not create heavy formats like docx/pptx unless requested or clearly implied.
- Do not overwrite existing user files without checking current content first.
- Prefer simple durable formats over fancy ones when requirements are vague.
