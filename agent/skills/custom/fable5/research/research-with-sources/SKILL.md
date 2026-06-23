---
name: research-with-sources
description: Evidence-backed research workflow for web, docs, and source investigation with concise citations and uncertainty handling. Use when the user asks for current facts, product/API details, comparisons, rankings, market/news research, or any answer that depends on external sources.
---

# Research With Sources

## Trigger

Use this when the answer depends on external/current facts, vendor docs, release notes, policy, pricing, model/product capabilities, rankings, comparisons, or a URL the user supplied.

Do not use for stable fundamentals, local repo facts, or purely conversational advice unless the user asks for sources.

## Workflow

1. Identify claim type:
   - Current/volatile → verify.
   - Product/API/version-specific → verify against official docs first.
   - Comparison/ranking → gather at least one source per major entity plus neutral/primary sources.
   - User-provided URL → fetch/read that URL before answering.
2. Prefer sources in this order:
   - Official docs, release notes, standards, source repos.
   - Primary data, filings, papers, vendor status pages.
   - Reputable secondary reporting.
   - Forums/blogs only for examples, sentiment, or unresolved bugs.
3. Search scope:
   - Simple fact → one focused lookup.
   - Medium comparison → 2-4 varied queries.
   - Deep research → plan source types first, then search/fetch iteratively.
4. Extract only decision-relevant evidence. Track date, version, and source quality.
5. Synthesize in Korean. Keep citations/links close to the claim they support.
6. If sources conflict, say what conflicts, which source is stronger, and what remains uncertain.

## Output Shape

- Start with direct answer.
- Then compact evidence bullets or a table when comparison helps.
- Include links/source names for non-obvious claims.
- End with residual uncertainty only if it matters.

## Guardrails

- Do not guess current product facts, pricing, limits, policies, or availability.
- Do not over-cite obvious or local facts.
- Do not quote long passages. For article/book/transcript summaries, use `copyright-safe-summary` too.
- If no reliable source is found, say so plainly and avoid filling gaps with speculation.
