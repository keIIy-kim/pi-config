---
name: artifact-html-builder
description: Build polished standalone HTML, CSS, JS, or React-style browser artifacts with durable structure and validation. Use when the user asks for an interactive demo, visual prototype, standalone web page, browser artifact, HTML app, dashboard, animation, or rich single-file UI that is not specifically a slide deck.
---

# Artifact HTML Builder

## Trigger

Use for standalone browser deliverables: interactive demos, dashboards, calculators, visual explainers, HTML reports with interactions, animation-heavy prototypes, and single-page UI artifacts.

Do not use for slide decks; use `frontend-slides` instead.

## Workflow

1. Clarify goal/aesthetic only if missing details block useful output.
2. Prefer a single self-contained HTML file unless project conventions require otherwise.
3. Structure cleanly:
   - semantic HTML
   - CSS variables/design tokens
   - isolated JS state
   - no hidden external runtime assumptions
4. Make the visual design intentional: spacing, typography, contrast, responsive layout, empty/loading/error states.
5. Validate by opening/running or at least checking syntax/static references.
6. Report path, features, and validation.

## Implementation Rules

- Keep CSS/JS in the file for standalone artifacts unless user asks otherwise.
- Use progressive enhancement: visible content first, interactions second.
- Avoid fragile browser storage assumptions. If persistence is required, ask or document the storage choice.
- Do not add heavy dependencies for simple interactions.
- If using CDNs, choose stable URLs and provide a no-network fallback when practical.
- Accessibility basics: labels, keyboard focus, reduced-motion where animation is heavy, sufficient contrast.

## Quality Checklist

- Clear information hierarchy.
- Works at mobile and desktop widths.
- No console errors in normal path.
- Handles empty/error input.
- Animations support comprehension, not decoration only.
- File can be opened directly in a browser.
