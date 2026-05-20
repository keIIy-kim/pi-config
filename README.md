# pi-config

pi 설정 백업.

## 위치

pi user config home:

```bash
~/.pi
```

이 repo의 `agent/`는 여기에 둡니다.

```bash
~/.pi/agent
```

clone 예시:

```bash
git clone https://github.com/keIIy-kim/pi-config.git ~/repos/pi-config
```

필요한 파일만 `~/.pi/agent/`로 복사하거나, `~/.config/pi/agent`에 두고 symlink로 연결합니다.
덮어쓰기 전 기존 `~/.pi/agent` 백업 필요.

## packages

| Package | Version | Link | 목적 |
| --- | ---: | --- | --- |
| `pi-subagents` | `0.24.3` | [pi.dev](https://pi.dev/packages/pi-subagents) | subagent workflow |
| `pi-simplify` | `0.2.1` | [pi.dev](https://pi.dev/packages/pi-simplify) | workflow 단순화 |
| `@juicesharp/rpiv-todo` | `1.10.2` | [pi.dev](https://pi.dev/packages/@juicesharp/rpiv-todo) | TODO 추적 |
| `pi-rtk-optimizer` | `0.7.1` | [pi.dev](https://pi.dev/packages/pi-rtk-optimizer) | RTK optimizer |
| `@capyup/pi-goal` | `0.6.0` | [pi.dev](https://pi.dev/packages/@capyup/pi-goal) | goal 관리 |
| `pi-prompt-template-model` | `0.9.3` | [pi.dev](https://pi.dev/packages/pi-prompt-template-model) | prompt template model |

lock: `agent/npm/package-lock.json`

설치 형식:

```bash
pi install npm:<package>
```

## 포함

- `agent/models.json`
- `agent/settings.json`
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

```bash
rsync -aL --delete --delete-excluded \
  --exclude-from ~/.pi/.gitignore \
  ~/.pi/ ~/repos/pi-config/
```

## scripts

- `symlink-pi-agent.sh` — symlink 생성
- `restore-pi-agent.sh` — `.bak` 원복
- `check-broken-symlinks.sh` — broken symlink 검사
