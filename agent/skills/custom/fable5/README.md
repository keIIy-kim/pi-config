# Fable 5 Skills

Claude Fable 5 prompt leak/OSINT에서 쓸만한 workflow만 작게 추출한 pi skills 모음.

원칙:
- system prompt에 긴 정책을 넣지 않는다.
- 반복 작업 SOP만 skill로 분리한다.
- Claude.ai 전용 identity/tool schema/product marketing은 넣지 않는다.
- 각 skill은 특정 trigger가 있을 때만 로드되게 유지한다.

## Skills

| Group | Skill | Use when |
|---|---|---|
| `research/` | `research-with-sources` | current facts, docs 조사, 비교/랭킹, 외부 source 필요한 답변 |
| `content/` | `copyright-safe-summary` | 기사/책/가사/긴 문서 요약, quote/excerpt 요청 |
| `deliverables/` | `file-deliverable-router` | inline 답변 vs 파일 산출물 판단, format routing |
| `product/` | `product-docs-verifier` | pi/Claude/API/SDK/model/pricing/limits/docs 확인 |
| `engineering/` | `code-review-checklist` | diff/PR/staged changes/code audit 리뷰 |
| `engineering/` | `release-validation` | pre-PR/pre-release/final validation |
| `artifacts/` | `artifact-html-builder` | standalone HTML/browser artifact/demo/dashboard/UI |

## Deliberately excluded

- `safe-refusal-style`: 낮은 우선순위. 필요하면 나중에 별도 추가.
- Claude/Fable identity, Anthropic product marketing, full safety policy, full tool schemas.
- Claude.ai `/mnt/user-data`/Artifacts runtime-specific details that do not apply to pi.

## Reload

Existing pi session: run `/reload` to pick up new skills.
New pi session: loaded automatically.
