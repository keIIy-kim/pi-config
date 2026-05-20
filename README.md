# pi-config

Personal [pi](https://github.com/earendil-works/pi-coding-agent) configuration snapshot.

이 repo는 `~/.pi` 설정을 symlink가 아닌 실제 파일로 복사한 백업입니다.
원본 설정은 `~/.pi` / `~/.config/pi`에 그대로 둡니다.

## Installed pi packages

`agent/settings.json` 기준 활성화된 package입니다.

| Package | Version | Purpose |
| --- | ---: | --- |
| `pi-subagents` | `0.24.3` | subagent orchestration / reviewer, worker, planner 등 agent workflow |
| `pi-simplify` | `0.2.1` | simplify helpers |
| `@juicesharp/rpiv-todo` | `1.10.2` | TODO/task tracking tool |
| `pi-rtk-optimizer` | `0.7.1` | RTK optimizer extension/config |
| `@capyup/pi-goal` | `0.6.0` | goal / sisyphus goal management |
| `pi-prompt-template-model` | `0.9.3` | prompt template model support |

Exact versions are pinned in `agent/npm/package-lock.json`.

## Packaged skills

현재 snapshot에 포함된 packaged skill set입니다.

### Engineering

- `diagnose` — reproduce/minimise/hypothesise/instrument/fix/regression-test loop
- `grill-with-docs` — plan stress-test with `CONTEXT.md` / ADR updates
- `improve-codebase-architecture` — architecture refactoring/deepening opportunities
- `prototype` — throwaway prototype for UI/state/model exploration
- `tdd` — red-green-refactor workflow
- `to-issues` — convert plan/spec into issue slices
- `to-prd` — turn context into PRD
- `triage` — issue triage workflow
- `zoom-out` — zoom-out/planning skill

### Productivity

- `caveman` — ultra-compressed communication mode
- `grill-me` — decision-tree interview / plan stress-test
- `handoff` — compact current context into handoff
- `write-a-skill` — create new pi skills

## Custom local skills

Custom-made local skills are also tracked:

- `frontend-slides`
- `workspace`

## Extensions tracked

Local extension files under `agent/extensions/`:

- `caffeinate`
- `custom-footer`
- `custom-splash`
- `permission-gate`
- `preset`
- `title-status`
- `pi-rtk-optimizer/config.json`

## Models / defaults

- default provider: `openai-codex`
- default model: `gpt-5.5`
- enabled models:
  - `openai-codex/gpt-5.5`
  - `querypie-kimi/kimi-k2.6`
- theme: `soft-dracula`
- default thinking level: `medium`
- compaction enabled

## Snapshot / restore notes

This repo was created with dereferenced symlink copy:

```bash
rsync -aL --delete --delete-excluded --exclude-from ~/.pi/.gitignore ~/.pi/ ~/repos/pi-config/
```

`.gitignore` excludes sessions, logs, caches, backups, runtime DBs, generated binaries, and local scratch files.

Helper scripts:

- `symlink-pi-agent.sh` — create `~/.pi/agent` symlinks from `~/.config/pi/agent`
- `restore-pi-agent.sh` — restore previous `.bak` files after symlink migration
- `check-broken-symlinks.sh` — detect broken symlinks under `~/.pi/agent`
