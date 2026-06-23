# Pi Design Mode

Pi Design Mode는 Vite React 화면에서 UI 요소를 선택하고, 선택한 요소의 TSX source/context를 Pi에 전달하는 로컬 개발용 확장입니다.

## Scope

- Global Pi extension 위치:
  - `~/.config/pi/agent/extensions/pi-design-mode/`
  - `~/.pi/agent/extensions/pi-design-mode/` symlink 환경에서도 동일
- Deck repo에는 extension 본문을 넣지 않습니다.
- Deck repo는 `scripts/dev --design`으로 설치된 extension을 찾아 쓰기만 합니다.

## Files

```txt
index.ts              Pi command + local bridge
vite-plugin.mjs       Vite React instrumentation + browser overlay
reference-worker.cjs  TypeScript LanguageService reference worker
```

## Deck usage

일반 개발자는 Design Mode를 켜지 않습니다.

```bash
./scripts/dev restart -s deskpie -p 22
```

Design Mode 사용자만 opt-in 합니다.

```bash
./scripts/dev restart -s deskpie -p 22 --design
```

Pi에서 bridge를 연결합니다.

```txt
/reload
/design-connect 22
```

포트 규칙:

```txt
suffix 22 → FE 4022, BE 8022, DB 5022, bridge 9022
```

## Pi commands

```txt
/design                 현재 상태 표시
/design-connect <N>     bridge 시작, token deck-dev-<N>
/design-clear           선택 context 제거
/design-exit            bridge 종료
/design-help            도움말
```

## Browser controls

```txt
Cmd+Shift+D / Ctrl+Shift+D   selector toggle
Option/Alt hold              temporary select
Click                        select element
Esc                          browse mode / clear overlay
1-9                          target 선택
[ / ]                        target cycle
```

## Browser panel

선택 후 표시:

```txt
- selected component/source
- target chain
- className
- computed style summary
- selected attributes
- TypeScript references
- open source / open reference in VS Code
- Ask Pi box
```

Ask submit 시에만 선택 context가 Pi로 전송됩니다. 일반 prompt에는 자동으로 계속 붙지 않습니다.

## Plugin resolution from Deck

`scripts/dev --design`은 아래 순서로 `vite-plugin.mjs`를 찾습니다.

```txt
1. <deck>/.pi/extensions/pi-design-mode/vite-plugin.mjs
2. ~/.pi/agent/extensions/pi-design-mode/vite-plugin.mjs
3. ~/.config/pi/agent/extensions/pi-design-mode/vite-plugin.mjs
```

Project-local copy가 있으면 우선되지만, 기본 운용은 global copy만 유지합니다.

## Notes

- React 19에서 LocatorJS `_debugSource`가 없어 안정적이지 않아 Vite JSX instrumentation을 사용합니다.
- References는 TypeScript LanguageService를 먼저 사용하고, 실패 시 ripgrep fallback을 사용합니다.
- Bridge는 로컬 개발용입니다. token은 suffix 기반(`deck-dev-<N>`)이며 보안 경계로 보지 않습니다.

## Known limitations

- TypeScript reference daemon/cache는 file mtime invalidation이 아직 약합니다. stale refs 가능.
- JSX generic custom component instrumentation은 일부 skip될 수 있습니다.
- Browser extension 없이 동작하지만 Vite dev server instrumentation이 필요합니다.
- 원격/공유 환경이 아니라 localhost 개발 전용입니다.
