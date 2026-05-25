# pi-config

pi 설정 백업/복구용 repo.

## 위치

Primary runtime path:

```bash
~/.pi/agent
```

Dotfiles-managed path:

```bash
~/.config/pi/agent
```

이 repo는 파일 기반 snapshot 보관처:

```bash
~/repos/pi-config/agent
```

새 머신에서는 둘 중 하나로 사용합니다.

1. `~/repos/pi-config/agent`를 `~/.pi/agent`로 복사
2. 또는 `~/.config/pi/agent`에 두고 `~/.pi/agent/*`를 symlink

## packages

| Package | Version | 목적 |
| --- | ---: | --- |
| `pi-subagents` | `0.25.x` | subagent workflow |
| `@juicesharp/rpiv-todo` | `1.12.x` | TODO 추적 |
| `pi-rtk-optimizer` | `0.8.x` | RTK optimizer |
| `@capyup/pi-goal` | `0.6.x` | goal 관리. 원본 extension은 disabled, `goal-guard.ts` wrapper 사용 |
| `pi-prompt-template-model` | `0.9.x` | prompt/model template |
| `@spences10/pi-lsp` | `0.0.x` | LSP diagnostics/hover/definition/references |

lock: `agent/npm/package-lock.json`

설치 형식:

```bash
pi install npm:<package>
```

## LSP

Pi LSP는 `@spences10/pi-lsp` 사용. Language server binary는 Neovim Mason 설치본 재사용.

주요 binary:

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

`~/.config/zsh/.zshrc`에서 Mason bin을 `PATH`에 추가. Pi child process lookup용으로 active mise Node bin과 `~/.pi/agent/bin/`에도 symlink 가능.

검증:

```bash
command -v typescript-language-server
typescript-language-server --version
```

Pi 안에서:

```text
/lsp status
lsp_diagnostics file=/absolute/path/to/file.ts
```

정상 예:

```text
/path/to/file.ts: no diagnostics
```

## local extensions

### `agent/extensions/inline-skill.ts`

`$skill` inline invocation/autocomplete.

- `/` slash command UX 유지
- `$tdd`, `$diagnose` 등 지원
- multi-skill은 combined block

### `agent/extensions/goal-guard.ts`

`@capyup/pi-goal` wrapper. 원본 package 파일은 수정하지 않음.

`agent/settings.json`에서 원본 extension disabled:

```json
{
  "source": "npm:@capyup/pi-goal",
  "extensions": []
}
```

현재 cwd의 `.pi/goals/active_goal_*.md`에 backing file이 없는 legacy goal focus를 차단. 새/unrelated session에서 기대 상태:

```text
Goal unfocused
Run /goal-focus to choose this session's goal
```

## 포함

- `agent/models.json`
- `agent/settings.json`
- `agent/README.md`
- `goal-auditor.json`
- prompts / themes / extensions
- packaged skills
- custom skills: `frontend-slides`, `workspace`

## 제외

- sessions / logs / cache / temp
- runtime DB
- backups / archives
- scratch files
- generated binaries

## snapshot

파일 기반 snapshot 갱신:

```bash
rsync -aL --delete --delete-excluded \
  --exclude-from ~/.pi/.gitignore \
  ~/.pi/ ~/repos/pi-config/
```

현재는 필요한 파일만 선별 복사하는 것을 선호합니다. 전체 rsync는 runtime 상태까지 섞일 수 있으니 diff 확인 필수.
