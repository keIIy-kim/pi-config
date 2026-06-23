---
name: product-docs-verifier
description: Verify product, API, SDK, model, pricing, limits, and tool behavior against current docs before answering or implementing. Use when the user asks about pi, Claude/Anthropic products, SDKs, extensions, skills, TUI, providers, model names, pricing, rate limits, or recently changed platform behavior.
---

# Product Docs Verifier

## Trigger

Use for product facts that can drift: model IDs, pricing, limits, SDK APIs, config keys, CLI flags, extension hooks, TUI APIs, provider behavior, feature availability, and migration guidance.

## Workflow

1. Identify the product and exact claim needed.
2. Prefer local official docs for installed tools; otherwise use official web docs.
3. For pi topics, inspect the installed pi README/docs/examples relevant to the feature.
4. Follow cross-references before implementing against an API.
5. If docs and code disagree, trust code for installed behavior and mention the mismatch.
6. Answer with version/path/source context when useful.

## Pi Doc Lookup Hints

- Start with pi README for overview.
- Use docs for specifics: extensions, skills, prompt templates, themes, TUI, SDK, models, packages.
- Use examples when implementing extensions, custom tools, SDK integrations, or UI.
- Read relevant `.md` files completely enough to avoid missing constraints.

## Output

- Direct answer first.
- Include source doc paths or links for key claims.
- Separate verified facts from assumptions.
- Avoid guessing about unavailable or post-cutoff product behavior.
