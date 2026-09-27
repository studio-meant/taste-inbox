# Taste Inbox R&D

GitHub에서 별을 누르고 Hugging Face에서 좋아요를 누른 것들을 모아, **왜 나에게 의미가 있는지 조사하고,
가장 작은 한 걸음을 샌드박스 안에서 안전하게 시험해 보는** local-first 개인 R&D 에이전트.

```text
⭐ GitHub Star · ❤️ Hugging Face Like (model · dataset · Space)
→ 수집 · 정규화 · 중복 제거                                  공식 API 두 개뿐
→ arXiv 태그를 따라 Paper → Code · Model · Dataset · Demo 번들
→ 개인 관심 맥락 (TasteContext)                              결정적 SQL, 로컬
→ NVIDIA AI-Q 조사 (인용과 함께)                            무엇이 어디로 가는지 먼저 보여줌
→ 가장 작은 검증 가능한 한 걸음 (SuggestedAction + TrialPlan)
→ 사용자가 "Try safely" 승인                                조건을 앞에 두고 두 번 누름
→ NemoClaw/OpenShell 샌드박스 안에서 OpenClaw 에이전트 실행   호스트 파일시스템 없음, egress 기본 차단
→ 결과 · 에이전트 보고 · 막힌 연결을 증거로 Focus Canvas에
```

개인 데스크톱 제품 `taste-inbox`에서 갈라져 나왔다. 원본은 읽기 전용이다 — [`docs/PROVENANCE.md`](./docs/PROVENANCE.md).
결정은 [`docs/DECISIONS.md`](./docs/DECISIONS.md), 설계는 [`docs/NVIDIA_HACKATHON_PLAN.md`](./docs/NVIDIA_HACKATHON_PLAN.md),
이 기계에서 실제로 확인한 것은 [`docs/FEASIBILITY.md`](./docs/FEASIBILITY.md).

## 무엇이 어디로 나가는가

"데이터가 기계를 떠나지 않는다"는 **사실이 아니다.** 조사는 AI-Q와 관리형 추론을 쓴다.

| 나가지 않는다 | 나간다 (고른 추론 경로로) |
| --- | --- |
| SQLite 수집 이력, 미디어 캐시 | 조사 질문 (ResearchBrief) |
| GitHub·HF 토큰, NVIDIA 자격증명 | 관심 맥락의 **요약** — 주제·태그·분포 |
| 브라우저 프로필·쿠키 | 공개 식별자 (저장소 이름, arXiv id) |
| 이 Mac의 파일 (샌드박스에 마운트하지 않음) | 실행 계획과 샌드박스 관측 요약 |

AI-Q를 **이 기계에** 띄우는 것이 기본값이다. Focus Canvas는 조사 버튼을 누르기 전에 보낼 질문 원문과
목적지 주소(이 기계 / 외부 서버)를 보여준다. `AIQ_SERVER_URL`에는 기본값이 없다 — 비어 있으면 보내지 않는다.

## NVIDIA 컴포넌트가 하는 일

| 컴포넌트 | 빼면 무너지는 것 |
| --- | --- |
| **AI-Q** (`aiq-research`) | 제안 자체. 무엇이고, 내 관심과 어떻게 이어지고, 가장 작은 첫 걸음은 무엇인지 — 인용과 함께 |
| **OpenShell** | `Try safely`가 성립하는 유일한 근거. deny-by-default egress, `/sandbox`·`/tmp`만 쓰기 가능 |
| **OpenClaw** | 저장소마다 다르게 실패하는 설치를 읽고 다음 수를 고르는 루프. 고정 스크립트로 대체 불가 |
| **네트워크 정책** | 막힌 연결 시도는 로그가 아니라 **사용자에게 보여주는 발견**이다 (Policy ledger) |

## 필요한 것

- Apple Silicon Mac, Node 22+, pnpm, [uv](https://docs.astral.sh/uv/), Docker Desktop
- NemoClaw + OpenShell 샌드박스 (`nemoclaw onboard`, **`--host-mount` 없이**)
- 로컬 AI-Q 백엔드 ([NVIDIA-AI-Blueprints/aiq](https://github.com/NVIDIA-AI-Blueprints/aiq)) + `NVIDIA_API_KEY`·검색 키
- `~/.claude/skills/`에 `aiq-research`·`aiq-deploy`·`nemoclaw-user-guide`

자세한 설치와 실측 결과는 [`docs/FEASIBILITY.md`](./docs/FEASIBILITY.md) §F1–F5.

## 실행

```bash
pnpm install
cd apps/api && uv sync && DATABASE_URL="sqlite:///$PWD/../../var/data/taste-inbox.db" uv run alembic upgrade head && cd ../..
cp .env.example .env   # GITHUB_TOKEN · GITHUB_LOGIN · HF_USERNAME · AIQ_SERVER_URL · NEMOCLAW_SANDBOX_NAME
```

**1. 수집** — 공식 API만. 토큰은 환경에서 읽고 출력하지 않는다.

```bash
cd services/collectors
uv run probe api --source github_stars_api --limit 120
uv run probe api --source huggingface_activity --limit 20
cd ../../apps/api && uv run python -m taste_inbox.ingest.cli
```

**2. AI-Q** — 반드시 loopback에. `start_as_skill.sh`의 기본 호스트는 `0.0.0.0`이다.

```bash
cd <aiq checkout> && ./scripts/start_as_skill.sh \
  --config_file configs/config_web_default_llamaindex.yml --host 127.0.0.1 --port 8010
```

**3. 샌드박스 정책** — 경계를 넓히는 일은 사람이 한다. 제품은 명령을 보여줄 뿐 실행하지 않는다.

```bash
nemoclaw taste-inbox policy add github --yes
nemoclaw taste-inbox policy add pypi --yes
nemoclaw taste-inbox policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --dry-run
nemoclaw taste-inbox policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --yes
```

**4. 앱** — 로컬 AI-Q는 Dask 대시보드를 8787에 띄우므로 API 포트를 옮긴다.

```bash
TASTE_INBOX_API_PORT=8790 pnpm dev      # http://127.0.0.1:4173
```

Today의 **Working Queue** → 항목 → **Focus Canvas 열기** → `AI-Q로 조사하기` → `안전하게 실행 (Try safely)`.
Browse는 `All · Trends · None`이다 — 이 에디션은 브라우저 수집기를 돌리지 않아 Style·Music·Places를 채울
공급원이 없다 (`.taste-inbox-community`). 라우트는 남아 있다.

`pnpm dev:mock`은 API 없이 픽스처로 화면만 띄운다. 목업 모드는 AI-Q와 샌드박스를 부르지 않고 그렇다고 말한다.

## 검증

```bash
pnpm verify:all
```

prettier · eslint · 타입 검사 · JS 단위 테스트 · Playwright E2E(모든 화면 스모크 + Focus) · ruff · mypy ·
pytest · 저장소 불변식. NVIDIA 런타임을 치는 테스트는 **기록된 출력**으로 돈다 (`data/fixtures/research/`,
`data/fixtures/sandbox/`). Focus와 Working Queue의 payload는 API가 실제 엔드포인트로 `data/fixtures/focus/`에
고정하고, `packages/shared`가 같은 파일을 zod로 읽는다.

## 하지 않는 것

로그인 세션을 흉내 낸 HTML 수집, CAPTCHA·챌린지 우회, 자격증명 재사용, 호스트에서 README 명령 실행,
사용자 승인 없는 실행, 샌드박스에 호스트 파일시스템 마운트, `0.0.0.0` 노출. 공개 배포 경계는
[`docs/COMMUNITY_RELEASE.md`](./docs/COMMUNITY_RELEASE.md).
