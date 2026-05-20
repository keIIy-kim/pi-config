---
name: frontend-slides
description: Create stunning, animation-rich HTML presentations from scratch or convert PowerPoint/PPTX files to web slideshows. Use when the user wants to build slides, create a pitch deck, make a web presentation, generate a talk deck, convert PPT to HTML, or create zero-dependency browser-based slides. Helps non-designers discover their aesthetic through visual previews rather than abstract choices.
version: 17
created: 2026-05-17
updated: 2026-05-18
---
# Frontend Slides

Create zero-dependency, animation-rich HTML presentations that run entirely in the browser.

## Core Principles

1. **Zero Dependencies** — Single HTML files with inline CSS/JS. No npm, no build tools.
2. **Show, Don't Tell** — Generate visual previews, not abstract choices. People discover what they want by seeing it.
3. **Distinctive Design** — No generic "AI slop." Every presentation must feel custom-crafted.
4. **Viewport Fitting (NON-NEGOTIABLE)** — Every slide MUST fit exactly within 100vh. No scrolling within slides, ever. Content overflows? Split into multiple slides.

## Design Aesthetics

Avoid generic AI-generated aesthetics: Inter/Roboto/Arial/system-font hero slides, purple gradients on white, predictable card grids, gratuitous glassmorphism, or cookie-cutter layouts.

Focus on:

- **Typography:** Distinctive fonts that match the topic. Avoid generic defaults.
- **Color & Theme:** Commit to a cohesive aesthetic. Use CSS variables. Dominant colors with sharp accents beat timid palettes.
- **Motion:** Use high-impact CSS animations and staggered reveals. Include `prefers-reduced-motion`.
- **Backgrounds:** Build atmosphere with gradients, geometric patterns, scanlines, paper textures, or contextual effects.

Interpret creatively and make choices that feel designed for the context.

## Viewport Fitting Rules

These invariants apply to every slide:

- Every `.slide` has `height: 100vh; height: 100dvh; overflow: hidden;`
- All font sizes and spacing use `clamp(min, preferred, max)` — no fixed px/rem for major layout values.
- Content containers have viewport-relative max sizes.
- Images use `max-height: min(50vh, 400px)` or stricter.
- Height breakpoints exist for 700px, 600px, and 500px.
- Include `prefers-reduced-motion` support.
- Never negate CSS functions directly (`-clamp()`, `-min()`, `-max()` are silently ignored). Use `calc(-1 * clamp(...))`.

When generating, read `viewport-base.css` and include its full contents in every presentation.

### Content Density Limits Per Slide

| Slide Type | Maximum Content |
| --- | --- |
| Title slide | 1 heading + 1 subtitle + optional tagline |
| Content slide | 1 heading + 4-6 bullets OR 1 heading + 2 paragraphs |
| Feature grid | 1 heading + 6 cards maximum (2x3 or 3x2) |
| Code slide | 1 heading + 8-10 lines of code |
| Quote slide | 1 quote (max 3 lines) + attribution |
| Image slide | 1 heading + 1 image (max 60vh height) |

Content exceeds limits? Split into multiple slides. Never cram, never scroll.

## Workflow

### Step 0: Detect Intent

- **New Presentation** — Create from scratch. Go to Step 1.
- **PPT Conversion** — Convert a `.pptx`. Go to Step 4.
- **Enhancement** — Improve or restyle an existing HTML deck. Read it first, then follow Mode C.

**Mode C: Modification Rules**

1. Read the existing HTML before editing.
2. Preserve the selected design/theme unless the user explicitly requests redesign.
3. If reusing an old style, extract and preserve CSS variables, font links, nav JS, background effects, component classes, and signature elements.
4. Count existing elements against density limits before adding content.
5. If adding text/images would overflow, split into continuation slides automatically and tell the user.
6. After any modification, verify `.slide` overflow rules, new elements use `clamp()`, images have viewport-relative max-height, and content fits at 1280x720.

### Step 1: Content Discovery

Gather:

1. Purpose — pitch, teaching/tutorial, conference talk, internal presentation.
2. Length — short 5-10, medium 10-20, long 20+.
3. Content readiness — all ready, rough notes, topic only.
4. Inline editing — yes/no.

If the user has content, ask them to share it.

If images are provided:

1. Scan image files.
2. View each image with `read`.
3. For each, evaluate what it shows, usable/not usable, represented concept, dominant colors.
4. Co-design the outline around both text and images.
5. Confirm image selection/outline with the user.

### Step 2: Style Discovery

Show, don't tell.

Ask what feeling the audience should have: impressed/confident, excited/energized, calm/focused, inspired/moved. Then generate 3 distinct single-slide HTML previews from `STYLE_PRESETS.md` and open them, or present the preset list if the user already knows the desired style.

If a logo is usable, embed it in each style preview so the user sees their brand in context.

### Step 3: Generate Presentation

Before generating, read:

- `html-template.md` — HTML architecture and JS features
- `viewport-base.css` — mandatory CSS (include in full)
- `animation-patterns.md` — animation reference for the chosen feeling
- `STYLE_PRESETS.md` — exact preset typography/colors/signature elements

Key requirements:

- Single self-contained HTML file with inline CSS/JS.
- Full `viewport-base.css` inside `<style>`.
- Fonts from Fontshare or Google Fonts; never system fonts as the main aesthetic.
- Clear section comments for CSS/JS and each slide.
- Long JSON/config/code goes in folded `<details>` blocks or split slides.
- If inline editing requested, include editing JS from `html-template.md`.

### Step 4: PPT Conversion

1. Extract content: `python scripts/extract-pptx.py <input.pptx> <output_dir>` (install `python-pptx` if needed).
2. Confirm extracted slide titles, summaries, image counts.
3. Run style discovery.
4. Generate HTML preserving text, images from `assets/`, slide order, and speaker notes as HTML comments.

### Step 5: Delivery

1. Clean up temp previews.
2. Open the HTML with `open <file>` or provide the path.
3. Summarize file location, style, slide count, navigation, customization points, and editing mode if enabled.

### Step 6: Share & Export (Optional)

Offer live URL deployment or PDF export after delivery.

- Deploy: `bash scripts/deploy.sh <presentation>` after checking Vercel login.
- PDF: `bash scripts/export-pdf.sh <path-to-html> [output.pdf]`; mention animations become static snapshots.

## Supporting Files

| File | Purpose | When to Read |
| --- | --- | --- |
| `STYLE_PRESETS.md` | Curated visual presets with colors, fonts, signature elements | Step 2 and named-preset generation |
| `viewport-base.css` | Mandatory responsive CSS | Every generation/update |
| `html-template.md` | HTML structure, JS features, code quality standards | Step 3 |
| `animation-patterns.md` | CSS/JS animation snippets and feeling guide | Step 3 |
| `scripts/extract-pptx.py` | PPT extraction | Step 4 |
| `scripts/deploy.sh` | Deploy to Vercel | Step 6 |
| `scripts/export-pdf.sh` | Export to PDF | Step 6 |

## Progressive Disclosure

Main `SKILL.md` is the workflow map. Load supporting files only when needed:

1. Always: this file.
2. Step 2: `STYLE_PRESETS.md`.
3. Step 3: `html-template.md`, `viewport-base.css`, `animation-patterns.md`.
4. Step 4: `scripts/extract-pptx.py`.
5. Step 6: deploy/export scripts.

## Procedure
Use this as an audience-copy source-of-truth overlay on top of the main Workflow.

1. **Create or update `script.md` before full HTML generation** when the task includes new deck content, a narrative arc, speaker copy, or non-trivial copy changes. Skip this only for quick style previews, tiny visual tweaks, or explicit user requests to edit HTML directly.
2. **Lock the script first.** Make `script.md` slide-by-slide: visible title/body/code/config/image intent for each slide, plus speaker/internal notes in Markdown comments such as `<!-- speaker: ... -->`. Do not put internal notes in visible slide copy.
3. **Separate copy review from visual work.** Iterate on `script.md` until the audience-facing wording and slide order are accepted, then generate or patch HTML from that script.
4. **Preserve approved design when updating.** For existing decks or old-style references, read the HTML first and reuse CSS variables, fonts, nav JS, background effects, component classes, and signature visual elements. Change content/layout only as needed for the locked script.
5. **Patch generated HTML from current anchors, not memory.** Before editing an existing slide, locate the current region with `rg`/`read` using stable anchors such as slide comments, headings, file labels, or unique prompt text. Use the freshly read block for exact replacement. If a replacement fails, re-read the target region before retrying; do not resend stale `oldText`.
6. **Prefer small deterministic replacements.** For one-off slide updates, replace the smallest unique slide block or content block. For repeated structural rewrites across many slides, use a scripted transform and then inspect the diff/affected regions.
7. **Keep script and HTML synchronized.** If accepted changes are made directly in HTML after generation, immediately mirror audience-copy changes back into `script.md` so future edits do not drift.
8. **Handle code-heavy slides explicitly.** Show filename/path in the title or label, split long config/code across slides or folded `<details>` blocks, and keep code at the deck standard size instead of shrinking until unreadable.
9. **Verify before delivery.** Compare final slide count and outline against `script.md`, search HTML for internal-only notes/rejected phrases, then open or provide the final HTML path.
## Pitfalls
- Do not regenerate an approved HTML deck from scratch just because the script changed; preserve the selected design/theme and patch content unless the user requests redesign.
- Do not mix copywriting and visual redesign in the same iteration. Lock `script.md` first, then update HTML.
- Do not render internal notes into slides. Phrases like "tone framing," "this is not an exclusivity claim," "agent note," or "verify later" belong in script comments/notes, not the audience-facing deck.
- Do not present exact command behavior (for example `/reload` scope) from memory. Check official docs; when docs are missing or stale, trace source and cite exact scope in the script.
- Do not replace real config/code blocks with screenshots/placeholders when the user asked to show setup instructions.
- If using a named preset (for example Terminal Green), read `STYLE_PRESETS.md` and follow its exact typography, colors, and signature elements.
- If preserving an old style, do not approximate from memory. Extract/reuse CSS/JS/design tokens from the old HTML and change only needed slide content.
- When exact-text edits fail on large generated HTML/Markdown decks, do not retry the same stale block. Re-read the current target region, anchor on unique slide comments/headings/file labels, and use smaller replacements or a scripted transform for repeated structural changes.
- When verifying slide count, do not count broad substrings like `class="slide` because they also match `slide-content`; count actual slide container tags such as `<section class="slide"` or `<div class="slide">`.
## Verification
- Confirm `script.md` exists for non-trivial decks and contains the locked slide outline/copy before generating or heavily patching HTML.
- Confirm final HTML still uses the user-approved preset/theme.
- Confirm slide count by counting actual slide container tags, not `slide-content` or substring matches.
- Confirm slide count and outline match the locked Markdown script.
- After failed exact-text edits, re-read the changed region and verify the replacement target exists exactly once before retrying.
- Search final HTML for internal-only notes or user-rejected phrases before opening/delivering.
- Confirm screenshot placeholders have stable paths under `assets/`.
- Confirm code/config examples use actual user-approved snippets and hide/fold long blocks when requested.
- Confirm named preset invariants are present (Terminal Green example: JetBrains Mono, GitHub dark `#0d1117`, terminal green `#39d353`, scan lines/cursor/code styling).
- Confirm product/tool behavior claims have evidence from docs/source, and update both `script.md` and HTML if a claim changes.