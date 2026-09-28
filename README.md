<h1 align="center">Taste Inbox</h1>

<p align="center">
  <strong>GitHub와 Hugging Face에 남겨둔 관심을 한곳에 모으고, 궁금한 점을 직접 실행해 Evidence로 남기는 로컬 R&D 에이전트</strong>
</p>

<p align="center">
  “써봐야지”로 끝나던 GitHub Star · Hugging Face Like · Upvote<br>
  문서를 읽는 데서 멈추지 않고, 실제로 돌려본 결과까지
</p>

<p align="center">
  <a href="#demo">Demo</a> ·
  <a href="#why">Why</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#install--usage">Install & Usage</a>
</p>

---

## Demo

<!-- 데모 영상: GitHub 첨부 영상으로 추가 예정 -->

---

## Why

새 논문·모델·라이브러리는 매일 저장되지만, 대부분 열어보지 않은 채 쌓임.

문서만으로는 알 수 없는 것:

| | 질문 |
|---|---|
| **Claims** | 논문 · README · 모델 카드가 할 수 있다고 말하는 것 |
| **Availability** | 그중 code · weights · API · demo로 실제 공개된 범위 |
| **Execution** | 내 환경에서의 설치 · 실행 여부, 필요한 의존성 · 네트워크 접근 |
| **Capability** | 내가 궁금한 용도에서 잘하는 것과 실패하는 지점 |

직접 써보기까지의 과정:

- 구현 저장소 찾기
- README · 모델 카드 읽기
- 의존성 · 런타임 맞추기
- 낯선 코드를 내 기계에 설치
- 실패 원인 추적

`Taste Inbox`는 이 과정을 조사 → 질문 → 계획 → 샌드박스 실행 → Evidence로 연결.

- 무엇을 확인할지: 사람
- 어떻게 확인할지: Agent

---

## What it does

| 단계 | 역할 |
|---|---|
| **Taste** | GitHub Star · Hugging Face Like · Upvote에서 관심사 파악 |
| **Inbox** | 기술 · 자료 · artifact를 한곳에 모으고 연결 |
| **Lab** | 궁금한 것을 조사하고, 직접 실행해 검증 |

현재 지원하는 기능:

| 기능 | 설명 |
|---|---|
| 관심 신호 수집 | 계정명만으로 GitHub Star, Hugging Face Like(model · dataset · Space), 논문 Upvote 수집 |
| Connected bundle | 논문 하나 → 코드 · 모델 · 데이터셋 · 데모 연결 |
| Inbox | 종류 · 출처별 정리, 카드마다 `Open in Lab` |
| AI-Q 조사 | 문서가 말하는 기능과 실제 공개 범위 조사, 인용 · URL 원문 보존 |
| 추천 질문 | 규칙 기반 질문 + Nemotron이 조사 근거로 넓힌 질문, 직접 입력도 가능 |
| Trial Plan | 질문 → 검증 목표 · 합격 기준 · 필요한 접속처 |
| Try safely | 사용자가 승인한 1건만, OpenShell 샌드박스 안에서 에이전트가 설치 · 실행 |
| Evidence | 종료 코드 · 도구 호출 · 소요 시간 · 에이전트 보고 · Nemotron 해석 · 막힌 연결(Policy Ledger) |

하지 않는 일:

- 로그인 세션을 흉내 낸 HTML 수집, CAPTCHA · 챌린지 우회
- 내 Mac(호스트)에서 README 명령 실행
- 사용자 승인 없는 실행
- 샌드박스에 호스트 파일시스템 마운트
- `0.0.0.0` 노출
- 샌드박스 네트워크 정책 자동 확장 — 경계 확장은 사람이 직접
- 강제 위치: [`docs/SECURITY_BOUNDARIES.md`](./docs/SECURITY_BOUNDARIES.md)

Hugging Face 논문 Upvote는 공식 API 부재 → Hub 웹페이지가 쓰는 공개 JSON을 로그인 · 쿠키 없이 조회.

---

## How it works

```text
Interest → Research → Question → Plan → Safe execution → Evidence
```

NVIDIA 스택:

| 구성 요소 | 역할 |
|---|---|
| **NVIDIA AI-Q** | 다출처 조사와 인용, 질문 기반 검증 목표 · 합격 기준 · Trial Plan 설계 |
| **Nemotron · NIM** | 조사 근거로 추천 질문 확장, 실행 결과를 합의된 기준과 대조해 해석 |
| **NemoClaw** | 샌드박스 수명주기와 에이전트 런타임 관리 |
| **OpenShell** | deny-by-default 네트워크, `/sandbox` · `/tmp`만 쓰기 가능 |
| **OpenClaw** | 저장소마다 다른 실패를 읽고 다음 수를 고르는 실행 루프 |

무엇이 어디로 나가는지:

| 이 기계 밖으로 나가지 않음 | 선택한 추론 경로로 나감 |
|---|---|
| SQLite 수집 이력 | 조사 질문 (ResearchBrief) |
| GitHub · Hugging Face 토큰, NVIDIA 자격증명 | 관심 맥락 요약 — 주제 · 태그 · 분포 |
| 브라우저 프로필 · 쿠키 | 공개 식별자 — 저장소 이름, arXiv id |
| 이 Mac의 파일 (샌드박스 마운트 없음) | Trial Plan, 샌드박스 관측 요약 |

- AI-Q 로컬 실행이 기본값
- `AIQ_SERVER_URL` 기본값 없음 — 비어 있으면 전송 안 함
- 전송 전 목적지 주소 화면 표시

Application stack: Next.js · FastAPI · SQLite · zod · pnpm · uv

---

## Install & Usage

준비물:

- Apple Silicon Mac
- Node.js 22+, pnpm, [uv](https://docs.astral.sh/uv/)
- Docker Desktop
- NemoClaw + OpenShell 샌드박스 (`nemoclaw onboard`, `--host-mount` 없이)
- NVIDIA API 키, Tavily API 키 (AI-Q 웹 검색)

### 1) 설치

```bash
git clone https://github.com/studio-meant/taste-inbox.git
cd taste-inbox
pnpm install
cp .env.example .env
```

`.env` 필수 항목:

- `AIQ_SERVER_URL=http://127.0.0.1:8010`
- `NEMOCLAW_SANDBOX_NAME=taste-inbox`
- `NVIDIA_API_KEY` — Nemotron 호출용, 호스트에만 보관 (샌드박스 · 브라우저로 전달 안 함)

선택 항목:

- `GITHUB_TOKEN` — 없으면 시간당 60회 제한
- `HF_TOKEN` — 공개 Like · Upvote에는 불필요

### 2) AI-Q 실행

처음 한 번:

```bash
git clone https://github.com/NVIDIA-AI-Blueprints/aiq.git ~/.local/share/taste-inbox/aiq
cd ~/.local/share/taste-inbox/aiq && uv sync
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
```

- `deploy/.env`에 `NVIDIA_API_KEY` · `TAVILY_API_KEY` 입력

실행 (loopback `127.0.0.1:8010` 고정):

```bash
pnpm aiq
```

### 3) 샌드박스 정책

경계 확장은 사람이 직접. 앱은 명령을 보여줄 뿐 실행하지 않음.

```bash
nemoclaw taste-inbox policy add github --yes
nemoclaw taste-inbox policy add pypi --yes
nemoclaw taste-inbox policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --dry-run
nemoclaw taste-inbox policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --yes
```

### 4) 앱 실행

```bash
pnpm dev
```

- 주소: `http://127.0.0.1:4173`
- 첫 실행 시 DB 자동 생성 → 온보딩 화면
- 8787 포트 충돌 시 (로컬 AI-Q의 Dask 대시보드): `TASTE_INBOX_API_PORT=8790 pnpm dev`
- NVIDIA 없이 화면만 확인: `pnpm dev:mock`

사용 흐름:

1. 온보딩 — 이름, GitHub · Hugging Face 계정명 입력 → 수집 시작
2. Today — 오늘 들어온 신호와 Connected bundle
3. Inbox — 카드에서 `Open in Lab`
4. Lab — AI-Q 조사 → 질문 선택 또는 직접 입력 → Trial Plan
5. `Try safely` — 조건 확인 후 승인 → 샌드박스 실행
6. Evidence — 실행 결과, Nemotron 해석, Policy Ledger

전체 검증: `pnpm verify:all`
