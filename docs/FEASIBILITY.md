# Phase 0 — NVIDIA feasibility spike 결과

> 실행 2026-09-28. 대상 호스트: 이 Mac (Apple M4, arm64, 16 GB RAM, 여유 디스크 284 GB).
> 계획서 §8.0의 F1~F6에 대응한다. **통과를 가장하지 않는다** — 실패는 오류 원문을 그대로 적는다.

## 요약

| # | 검증 항목 | 결과 |
| --- | --- | --- |
| F1 | 스킬 3종 설치 + `SKILL.md` 정독 | ✅ **통과** (1순위 경로 실패 → 공식 2순위 경로로 성공) |
| F2 | NemoClaw/OpenShell 샌드박스 생성 | ❌ **불가** — 컨테이너 런타임 없음 |
| F3 | 샌드박스 안 OpenClaw shell task | ⛔ **미실행** — F2 의존 |
| F4 | deny-by-default 허용/차단 실증 | ⛔ **미실행** — F2 의존 |
| F5 | AI-Q Research 1회 수행 | ❌ **불가** — 백엔드 없음 + 자격증명 없음 |
| F6 | 결과 기록 | ✅ 이 문서 |

**결론: NVIDIA 런타임 3종(AI-Q / NemoClaw / OpenShell) 중 이 호스트에서 지금 동작 가능한 것은 0개다.**
막는 것은 설계가 아니라 **환경**이고, 두 가지다 — 컨테이너 런타임 부재, 그리고 NVIDIA 자격증명 부재.

---

## 호스트 인벤토리 (실측)

```
$ uname -m                     → arm64
$ sysctl machdep.cpu.brand_string → Apple M4
RAM                            → 16 GB      (NemoClaw 권장치 16 GB, 최소 8 GB — 충족)
디스크 여유                     → 284 GB     (권장 40 GB — 충족)
```

| 도구 | 상태 | 비고 |
| --- | --- | --- |
| `git` | ✅ 2.39.5 | |
| `node` | ⚠️ **PATH에 없음.** 바이너리는 존재 | `~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` v24.19.0 (다른 도구가 번들한 것) |
| `npm` / `npx` | ❌ 없음 | 위 번들에 `node` 바이너리만 있고 npm/npx 미포함 |
| `pnpm` | ❌ 없음 | `~/Library/pnpm/store`(캐시)만 남아 있음 |
| `python3` | ✅ 3.9.6 (시스템) | AI-Q 스킬은 3.11+ 요구 |
| `python3.11` | ✅ `~/.local/bin/python3.11` | **AI-Q 스킬 요구치 충족** |
| `uv` | ❌ 없음 | AI-Q의 Docker-less 경로에 필요 |
| **Docker / Podman / Colima** | ❌ **전부 없음** | `/Applications`에 Docker Desktop 없음, `/opt` 비어 있음(Homebrew 없음) |
| `sudo` | ❌ 비밀번호 필요 | `sudo -n true` → `sudo: a password is required` |
| 네트워크 | ✅ | github.com 200, docs.nvidia.com 200 |

> 참고로 이 기계는 기업 관리 단말로 보인다 — `/usr/local/bin/sentinelctl`(SentinelOne),
> `/Applications/Microsoft Defender Shim.app`, `/Applications/BIG-IP Edge Client.app`.
> 컨테이너 런타임 설치가 정책으로 막혀 있을 가능성을 염두에 둔다.

또한 **이 기계에서 원본 저장소의 원격 뷰어가 지금 돌고 있다**
(`node .../taste-inbox/apps/web/server/remote.mjs`, 127.0.0.1:4178). 건드리지 않았다.

---

## F1 — 스킬 3종 설치 ✅

### 1순위(공식 카탈로그 CLI) — 실패

```
$ npx skills add nvidia/skills --skill aiq-deploy --agent claude-code --yes
(eval):2: command not found: npx
```

npm/npx가 없어 `npx skills add` 경로는 쓸 수 없다.

### 2순위(공식 User-Level Install) — 성공

AI-Q 공식 문서가 제시하는 대체 경로(`cp -R skills/<name> ~/.claude/skills/`)를 사용했다.

```bash
git clone --depth 1 https://github.com/NVIDIA/skills.git    # 공식 카탈로그, 스킬 383개
cp -R skills/{aiq-deploy,aiq-research,nemoclaw-user-guide} ~/.claude/skills/
```

설치 결과:

```
~/.claude/skills/
├── aiq-deploy/          SKILL.md · references/ 13개 · evals/ · skill-card.md · skill.oms.sig
├── aiq-research/        SKILL.md · scripts/aiq.py · evals/ · skill-card.md · skill.oms.sig
└── nemoclaw-user-guide/ SKILL.md · evals/ · skill-card.md · skill.oms.sig
```

### 정독 결과 — 설계에 반영해야 할 것

**`aiq-research` (v2.1.0)**

- `scripts/aiq.py`는 **third-party 의존성이 없다**(표준 라이브러리 HTTP만). → 이 제품이 AI-Q를
  부를 때 무거운 클라이언트 SDK를 들일 필요가 없다. 계획서 §2.3 `research/aiq_client.py`는
  이 스크립트를 서브프로세스로 부르는 쪽이 맞다.
- 기본 백엔드 `http://localhost:8000`, `AIQ_SERVER_URL`로 변경.
- **비로컬 URL은 https를 강제하고**(`_validate_base_url`), `user:password@` 형식을 거부한다.
- 스킬이 규정한 가드레일 — 계획서 §3.1이 적은 것과 일치하며, 추가로 발견한 것:
  - **질의를 보내기 전에 대상 백엔드 URL을 명시적으로 말해야 한다** (Step 2).
    비로컬이면 사용자가 그 URL을 신뢰한다고 확인해야 한다.
  - **query text에 자격증명·쿠키·토큰·비밀값을 넣지 않는다.**
  - 401/403이면 멈춘다. 이 공개 스킬은 인증을 관리하지 않는다.
  - 실패한 작업을 **자동 재시도하지 않는다.**
  - 리포트의 **citation과 source URL을 자르지 않는다.**
  - `job_id`가 없으면 폴링을 강요하지 않는다.
- 명령: `health · chat · agents · submit · research · research_poll · status · state · report
  [--out-dir] · report_edit · artifacts [--download-dir] · stream · cancel`
- 산출물은 `artifact://<id>` 링크로 오고 `artifacts --download-dir`로 실체화한다.
  `report --out-dir`는 링크를 로컬 파일로 재작성한 이식 가능한 `report.md`를 만든다.
  → 계획서의 "Evidence(provenance=aiq)" 적재에 그대로 쓸 수 있다.

> **계획서 §3.1에 추가할 것:** 백엔드 URL 고지와 "비밀값 금지"는 `skills/taste-agent/SKILL.md`의
> ResearchBrief 규칙(§3.4-2)과 **같은 요구**다. 두 곳에 따로 쓰지 말고 taste-agent가 aiq-research의
> 규칙을 상속한다고 명시한다.

**`aiq-deploy` (v2.1.0)** — 가장 중요한 발견

배포 모드가 4개이고, **그중 하나는 Docker가 필요 없다.**

| 모드 | 런타임 요구 |
| --- | --- |
| Docker Compose (기본) | Docker Engine + Compose v2 |
| **Skill backend** (`references/skill-backend.md`) | **Python 3.11+ 와 `uv`** — 컨테이너 불필요 |
| CLI | Python 3.11+ 와 `uv` |
| UI | Node.js 20+ 와 npm |
| Kubernetes/Helm | kubectl 1.28+, Helm 3.12+ |

Skill backend 경로의 기동 명령:

```bash
./scripts/start_as_skill.sh --config_file configs/config_web_default_llamaindex.yml --port 8000
```

→ backend API만 뜨고 UI·디버그 콘솔은 뜨지 않는다. `REQUIRE_AUTH=false` 전제.

**필요 자격증명** (`references/env-and-secrets.md`, `deploy/.env`):

| 키 | 필수 여부 |
| --- | --- |
| `NVIDIA_API_KEY` | **필수** (호스티드 모델 사용 시) |
| `TAVILY_API_KEY` / `SERPER_API_KEY` / `EXA_API_KEY` | **셋 중 최소 하나 필수** (웹 리서치) |
| `RAG_SERVER_URL` / `RAG_INGEST_URL` | 선택 |

**`nemoclaw-user-guide`**

이 스킬은 절차를 담지 않고 **문서로 보내는 스킬**이다. 핵심 지시:

- MCP를 지원하면 `https://docs.nvidia.com/nemoclaw/_mcp/server`를 붙이고 `searchDocs`를 쓴다.
- MCP가 없으면 `https://docs.nvidia.com/nemoclaw/llms.txt`를 먼저 읽고 `.md` 페이지를 가져온다.
- HTML URL만 찾았으면 `.html`을 `.md`로 바꾸거나 `.md`를 붙인다.
- **"stale한 복사본이나 생성된 skill reference로 답하지 말라"** — 계획서 요구사항 2번과 같은 말.
- 변종(OpenClaw / Hermes / Deep Agents)을 섞지 않는다.

> **조치:** 계획서 §10의 NemoClaw 근거 URL들을 `.md` 형태로 다시 확인하는 것이 공식 지침에
> 더 맞다. 그리고 이 세션에 NemoClaw docs MCP 서버를 붙이면 조사 품질이 올라간다.

---

## F2 — 샌드박스 생성 ❌ 불가

```
$ nemoclaw host probe
(eval):6: command not found: nemoclaw
$ openshell --version
(eval):10: command not found: openshell
```

설치되어 있지 않다. 설치 자체는 `curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash`이지만,
**선행 조건인 컨테이너 런타임이 없어 설치해도 온보딩이 실패한다.**

공식 전제조건 (`.../openclaw/get-started/prerequisites.md`, macOS Apple Silicon):

> "Colima, Docker Desktop" — 테스트된 선택지.
> "Start the container runtime (Colima or Docker Desktop) before installing."
> "NemoClaw uses the Docker-driver OpenShell gateway path with Docker Desktop or Colima."
> RAM 16 GB 권장 / 8 GB 최소, 디스크 40 GB 권장 / 20 GB 최소.
> 이 플랫폼은 "Tested with limitations"로 표기.

이 호스트 상태:

```
$ ls -d /Applications/*.app | grep -i docker   → (없음)
$ ls /opt                                      → (비어 있음 — Homebrew 없음)
$ which -a docker podman                       → docker not found / podman not found
$ sudo -n true                                 → sudo: a password is required
```

Colima 설치는 Homebrew(`brew install colima docker`)를 요구하고, Homebrew도 없다.
Docker Desktop 설치는 `/Applications` 쓰기와 권한 승인이 필요하다.

**→ 사람이 직접 해야 하는 단계다. 코드가 대신할 수 없고, 비밀번호가 필요하다.**

## F3 — OpenClaw shell task ⛔ 미실행

F2가 통과하지 못해 실행할 샌드박스가 없다. 설계상 명령은 확정되어 있다
(계획서 §3.2, `openclaw agent exec --message-file … --cwd … --state-dir … --timeout 900 --json`).
**검증되지 않았다는 사실을 기록한다.**

## F4 — deny-by-default 허용/차단 실증 ⛔ 미실행

동일. 계획서 §3.3의 정책 적용 명령
(`nemoclaw <sandbox> policy add --from-file`, `openshell policy update … --add-endpoint`)은
문서 기준으로 확정되어 있으나 **이 호스트에서 실행된 적이 없다.**

## F5 — AI-Q Research 1회 수행 ❌ 불가

스킬 자체는 정상 동작한다. 백엔드가 없다.

```
$ python3.11 ~/.claude/skills/aiq-research/scripts/aiq.py health
HTTP 404: {"detail":"Not Found"}
HTTP 404: {"detail":"Not Found"}
Traceback (most recent call last): … health() … _api_request("GET", "/")

$ python3.11 ~/.claude/skills/aiq-research/scripts/aiq.py agents
HTTP 404: {"detail":"Not Found"}
ERROR: HTTP 404
```

404는 "연결 실패"가 아니다 — **`localhost:8000`에 AI-Q가 아닌 다른 uvicorn 서버가 이미 떠 있다**
(120 KB짜리 정적 HTML을 서빙 중, 사용자의 다른 프로젝트로 보임). `health`는 `/health`와
`/v1/health`를 차례로 시도하고 둘 다 404를 받은 뒤 `/`로 떨어졌다.

→ AI-Q를 세울 때는 **8000이 아닌 다른 포트**를 써야 한다. 스킬 문서도 그렇게 안내한다
(`skill-backend.md`: "If port 8000 is already in use, choose another free port with `--port`").

막는 것은 포트가 아니라 둘이다:

1. **`uv`가 없다** — Skill backend 경로의 요구 도구.
2. **`NVIDIA_API_KEY`와 검색 프로바이더 키가 없다** — 사용자만 발급할 수 있다.

---

## 계획서에 미치는 영향

| P0 항목 | 영향 |
| --- | --- |
| 5 (스킬 설치 + AI-Q 기동 + `health` 통과) | 앞의 절반 ✅ 완료 / 뒤의 절반 ❌ 자격증명·`uv` 대기 |
| 6 (`nemoclaw onboard` + 정책 프리셋) | ❌ 컨테이너 런타임 대기 |
| 11 (research runner) | 코드는 쓸 수 있으나 **라이브 검증 불가** |
| 12 (trial runner) | 코드는 쓸 수 있으나 **라이브 검증 불가** |
| 14 (Focus Canvas) | 실행 결과 패널을 실데이터로 채우지 못함 |
| 1~4, 7~10, 13, 15, 16 | **영향 없음** — 진행 가능 |

**프런트엔드 별도 제약:** `npm`/`pnpm`이 없어 새 저장소에서 `pnpm install`을 할 수 없다.
`node` 바이너리는 있으므로 **이미 설치된 의존성이 있다면** 실행은 가능하지만, 이 저장소에는
`node_modules`가 없다. → P0 14~16의 UI 코드는 작성 가능하나 **빌드·E2E 검증이 막힌다.**

## 남은 결정

계획서 §8.3의 규칙대로, 이 blocker들은 "조용한 생략"이나 "mock 성공 처리"로 넘기지 않는다.
fallback이 P0 요구사항을 훼손하므로 **사용자 확인이 필요하다.** 결정 결과는 이 문서에 이어 적는다.
