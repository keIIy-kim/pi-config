# pi-config

내 pi 설정 백업 repo.

`~/.pi`의 symlink를 따라가 실제 파일로 복사한 snapshot입니다. 원본 설정은 건드리지 않습니다.

## 목적

- 새 장비에서 pi 설정을 빠르게 복구
- 내가 쓰는 package/skill/extension 구성을 한 곳에 기록
- symlink 대상 원본 파일까지 실제 내용으로 백업
- sessions/log/cache 같은 실행 중 생성물은 제외

## 설치한 pi packages

| Package | Version | 목적 |
| --- | ---: | --- |
| `pi-subagents` | `0.24.3` | 여러 agent를 나눠 실행하고 review/worker/planner workflow를 구성 |
| `pi-simplify` | `0.2.1` | pi 작업 흐름을 단순화하는 보조 기능 |
| `@juicesharp/rpiv-todo` | `1.10.2` | TODO/task 추적 |
| `pi-rtk-optimizer` | `0.7.1` | RTK optimizer 설정/extension |
| `@capyup/pi-goal` | `0.6.0` | goal/sisyphus goal 관리 |
| `pi-prompt-template-model` | `0.9.3` | prompt template model 지원 |

정확한 lock 정보: `agent/npm/package-lock.json`

## 포함된 설정

- model/default 설정: `agent/models.json`, `agent/settings.json`
- prompts/themes/extensions
- packaged skills
  - engineering: `diagnose`, `tdd`, `prototype`, `triage`, `to-prd`, `to-issues` 등
  - productivity: `caveman`, `grill-me`, `handoff`, `write-a-skill`
- custom skills
  - `frontend-slides`
  - `workspace`

## 제외한 것

`.gitignore`로 제외:

- sessions/logs/cache/temp
- runtime DB
- backups/archives
- local scratch files
- generated binaries

## snapshot 명령

```bash
rsync -aL --delete --delete-excluded \
  --exclude-from ~/.pi/.gitignore \
  ~/.pi/ ~/repos/pi-config/
```

## helper scripts

- `symlink-pi-agent.sh` — `~/.config/pi/agent`에서 `~/.pi/agent`로 symlink 생성
- `restore-pi-agent.sh` — `.bak` 파일에서 원복
- `check-broken-symlinks.sh` — 깨진 symlink 검사
