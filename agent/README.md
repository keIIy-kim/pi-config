# Pi Agent Configuration

> Dotfiles-managed configuration for [pi](https://pi.dev) — symlinked from `~/.pi/agent/`.

## What's here

| Path | Description |
|------|-------------|
| `APPEND_SYSTEM.md` | Global system prompt appended every session |
| `settings.json` | Global settings (thinking level, theme, transport, etc.) |
| `models.json` | Custom model/provider definitions |
| `extensions/` | TypeScript extensions (custom tools, UI, event handlers) |
| `skills/` | Agent skills following the [Agent Skills standard](https://agentskills.io) |
| `themes/` | Custom TUI themes |
| `prompts/` | Reusable prompt templates |

## What's NOT here

These stay in `~/.pi/agent/` and are never committed:

- `auth.json` — API keys & OAuth tokens
- `memory/` — Persistent session memory (SQLite DB + markdown)
- `sessions/` — Session JSONL logs
- `pi-crash.log`, `run-history.jsonl` — Runtime logs
- `cache/` — Cached artifacts
- `context-mode/` — Context mode DB
- `bin/` — Misc binaries

(Protected by `.gitignore`.)

## Symlink setup

On a new machine, clone dotfiles and run:

```bash
# Ensure ~/.config/pi/agent/ exists (it does if you cloned this repo)
# Then symlink from ~/.pi/agent/
ln -s ~/.config/pi/agent/extensions  ~/.pi/agent/extensions
ln -s ~/.config/pi/agent/skills     ~/.pi/agent/skills
ln -s ~/.config/pi/agent/themes     ~/.pi/agent/themes
ln -s ~/.config/pi/agent/prompts    ~/.pi/agent/prompts
ln -s ~/.config/pi/agent/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
ln -s ~/.config/pi/agent/settings.json    ~/.pi/agent/settings.json
ln -s ~/.config/pi/agent/models.json      ~/.pi/agent/models.json
```

If the originals already exist in `~/.pi/agent/`, back them up first:

```bash
mv ~/.pi/agent/extensions ~/.pi/agent/extensions.bak
# ... then create symlink
```

## Recovery

- **Broken symlinks**: `find ~/.pi/agent -maxdepth 1 -type l ! -exec test -e {} \; -print`
- **Restore from backup**: `~/.pi/agent-backup-<date>/` contains a full pre-migration copy
- **Restore script**: `~/.pi/restore-pi-agent.sh` restores from `.bak` files automatically

## LSP / code intelligence

Pi uses `npm:@spences10/pi-lsp` for language-server tools:

- `lsp_diagnostics`, `lsp_diagnostics_many`
- `lsp_hover`, `lsp_definition`, `lsp_references`
- `lsp_document_symbols`, `lsp_find_symbol`

The extension starts servers lazily on first LSP tool use for a file. It can resolve absolute file paths outside the current cwd and detect the workspace root from the file path.

Language server binaries are shared with Neovim Mason:

```text
~/.local/share/nvim/mason/bin/typescript-language-server
~/.local/share/nvim/mason/bin/pyright-langserver
~/.local/share/nvim/mason/bin/rust-analyzer
~/.local/share/nvim/mason/bin/gopls
~/.local/share/nvim/mason/bin/clangd
~/.local/share/nvim/mason/bin/bash-language-server
~/.local/share/nvim/mason/bin/vscode-html-language-server
~/.local/share/nvim/mason/bin/kotlin-lsp
```

Current shell setup adds Mason to `PATH` in `~/.config/zsh/.zshrc`. For Pi child-process lookup, these are also symlinked into the active mise Node bin and `~/.pi/agent/bin/`.

Verify:

```bash
command -v typescript-language-server
typescript-language-server --version
```

Inside Pi:

```text
/lsp status
```

Ask the agent to check a TypeScript file, or use the tool directly:

```text
lsp_diagnostics file=/absolute/path/to/file.ts
```

Expected clean-file result:

```text
/path/to/file.ts: no diagnostics
```

`/lsp restart all` is only needed after changing server binaries or recovering from a failed cached startup. Normal sessions auto-start on first LSP tool call.

## Local extensions

### `extensions/inline-skill.ts`

Adds `$skill` inline invocation/autocomplete without taking over Pi's `/` slash command UX.

- `$tdd`, `$diagnose`, etc. expand to skill blocks.
- Multiple skills combine into one block.
- `/skill:name` compatibility remains.

### `extensions/goal-guard.ts`

Wraps `@capyup/pi-goal` without patching the package. The package remains installed but its original extension is disabled in `settings.json`:

```json
{
  "source": "npm:@capyup/pi-goal",
  "extensions": []
}
```

The wrapper imports the original goal extension, then filters stale session focus entries so a goal only auto-focuses when it is backed by the current cwd's `.pi/goals/active_goal_*.md` file.

Expected safe state in a new/unrelated session:

```text
Goal unfocused
Run /goal-focus to choose this session's goal
```

## How to modify

Edit files in **this directory** (`~/.config/pi/agent/`) and `git commit`.

`~/.pi/agent/` paths should remain symlinks — do not edit in place or pi will write through to the symlink target anyway.
