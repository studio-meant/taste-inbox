# Phase 0 — NVIDIA feasibility spike 결과

> 실행 2026-09-28. 호스트: Apple M4, arm64, 16 GB RAM, 여유 디스크 284 GB.
> 계획서 §8.0의 F1~F6. **통과를 가장하지 않는다** — 실패한 시도는 오류 원문을 그대로 남겼다.

## 요약 — F1~F5 전부 통과

| # | 검증 항목 | 결과 |
| --- | --- | --- |
| F1 | 스킬 3종 설치 + `SKILL.md` 정독 | ✅ (1순위 경로 실패 → 공식 2순위 경로로) |
| F2 | NemoClaw/OpenShell 샌드박스 생성 | ✅ `taste-inbox` Phase: **Ready** |
| F3 | 샌드박스 안 OpenClaw shell task | ✅ 파일 생성 확인, `toolSummary.failures: 0` |
| F4 | deny-by-default 허용/차단 실증 | ✅ 허용 200 / 미허용 차단, **바이너리 차원까지** |
| F5 | AI-Q Research 실제 1회 | ✅ `job_id` + 1,995자 리포트 |
| F6 | 기록 | ✅ 이 문서 |

**설계 전제 세 개가 틀렸다는 것도 함께 확인했다** — §"설계에 반영해야 할 정정" 참조.
계획서 §3.2의 명령은 문서 기준으로 쓴 것이었고, 설치된 버전에는 그 플래그가 없다.

---

## 호스트와 도구

첫 시도 시점에 **Node·npm·pnpm·uv·Docker가 모두 없었고 sudo에 비밀번호가 필요했다.**
사용자가 Docker Desktop을 설치했고, Node 22·pnpm·uv는 사용자 레벨로 설치했다(관리자 권한 불요).

| 도구 | 상태 |
| --- | --- |
| Docker | 29.8.0, `linux/aarch64`, 10 CPU, 8.3 GB VM, Compose v5.5.1 |
| Node | v22.23.3 + npm 10.9.9 (`~/.local/opt/node`, tarball) |
| pnpm | 11.20.0 (corepack) |
| uv | 0.12.19 (`~/.local/bin`, 공식 standalone) |
| python3.11 | `~/.local/bin/python3.11` — AI-Q 스킬 요구치 |

> **함정 하나:** 설치 직후 `nemoclaw`가
> `The Docker context does not select the local default target`로 즉시 실패했다.
> Docker Desktop이 `desktop-linux` 컨텍스트를 기본으로 잡아서다.
> `docker context use default` 후 정상 진행. 재현 절차에 반드시 넣어야 한다.

이 기계는 기업 관리 단말이다(`sentinelctl`, Defender, F5). 정책 변동 가능성을 염두에 둔다.
`localhost:8000`은 사용자의 다른 프로젝트가 쓰고 있어 **AI-Q는 8010**에 띄웠다.

---

## F1 — 스킬 3종 설치 ✅

**1순위(공식 카탈로그 CLI) 실패** — 당시 npx가 없었다.

```
$ npx skills add nvidia/skills --skill aiq-deploy --agent claude-code --yes
(eval):2: command not found: npx
```

**2순위(공식 User-Level Install) 성공.** AI-Q 문서가 제시하는 대체 경로.

```bash
git clone --depth 1 https://github.com/NVIDIA/skills.git     # 공식 카탈로그, 스킬 383개
cp -R skills/{aiq-deploy,aiq-research,nemoclaw-user-guide} ~/.claude/skills/
```

### 정독에서 나온, 설계에 반영할 것

**`aiq-research` v2.1.0** — 백엔드 2.2.0과 호환(major 일치, minor 이상).

- `scripts/aiq.py`는 **third-party 의존성이 없다**(표준 라이브러리 HTTP만).
  → `research/aiq_client.py`는 무거운 SDK 대신 이 스크립트를 서브프로세스로 부른다.
- 비로컬 URL은 **https를 강제**하고 `user:password@`를 거부한다(`_validate_base_url`).
- 스킬이 강제하는 가드레일 — `skills/taste-agent`가 그대로 상속해야 한다:
  - **질의 전에 대상 백엔드 URL을 명시**한다. 비로컬이면 사용자 확인을 받는다
  - query text에 자격증명·쿠키·토큰·비밀값을 넣지 않는다
  - 401/403이면 멈춘다. **실패한 작업을 자동 재시도하지 않는다**
  - 리포트의 **citation과 source URL을 자르지 않는다**
  - `job_id`가 없으면 폴링을 강요하지 않는다

**`aiq-deploy` v2.1.0** — 가장 값진 발견: **Docker 없는 배포 경로가 있다.**

| 모드 | 요구 |
| --- | --- |
| Docker Compose (기본) | Docker Engine + Compose v2 |
| **Skill backend** | **Python 3.11+ 와 `uv`** — 컨테이너 불필요 ← 우리가 쓴 것 |
| CLI / UI / K8s | uv / Node+npm / kubectl+Helm |

필요 자격증명: `NVIDIA_API_KEY` **필수**, 검색 프로바이더(`TAVILY_API_KEY` 등) **최소 하나**.

**`nemoclaw-user-guide`** — 절차가 아니라 **문서로 보내는** 스킬.
`https://docs.nvidia.com/nemoclaw/llms.txt` → `.md` 페이지를 근거로 삼고,
"stale한 복사본이나 생성된 skill reference로 답하지 말라"고 명시한다.

---

## F2 — 샌드박스 생성 ✅

```bash
curl -fsSL https://www.nvidia.com/nemoclaw.sh | \
  NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
  NEMOCLAW_AGENT=openclaw NEMOCLAW_PROVIDER=build \
  NVIDIA_INFERENCE_API_KEY=<key> NEMOCLAW_SANDBOX_NAME=taste-inbox bash
```

결과:

```
Sandbox: taste-inbox        Phase: Ready
  Model:     nvidia/nemotron-3-super-120b-a12b
  Provider:  nvidia-prod
  Inference: healthy (https://inference.local/v1/models)
  OpenShell: 0.0.116 (docker)
  Agent:     OpenClaw v2026.7.1
  Policies:  brew, huggingface, npm, openclaw-pricing, pypi, tavily
  Dashboard: http://127.0.0.1:18789/
  Host GPU: no · Sandbox GPU: disabled (auto)
```

GPU 없음은 기대한 결과다(Apple Silicon). 추론은 `inference.local`을 통해 NVIDIA 엔드포인트로 간다.

---

## F3 — 샌드박스 안 OpenClaw 실행 ✅

### 먼저 확인한 경계

```
uname     Linux … 7.0.12-linuxkit aarch64        (컨테이너)
whoami    sandbox        HOME=/sandbox
/sandbox 쓰기             OK
/usr/bin 쓰기             Permission denied
ls /Users                No such file or directory
호스트 홈 보임?            NO
```

**호스트 파일시스템이 보이지 않는다.** 이것이 `DECISIONS.md` 2026-09-28이 기대는 사실이고,
`scripts/verify-repo.sh`가 `--host-mount`의 부재를 검사하는 이유다.

### 에이전트 실행

```bash
nemoclaw taste-inbox exec --timeout 600 -- sh -lc '
  mkdir -p /sandbox/work/f3 && cd /sandbox/work/f3
  openclaw agent --agent main --json --timeout 420 --session-id f3-probe \
    -m "Create a file at /sandbox/work/f3/verified.txt …"'
```

결과: `toolSummary: {calls: 2, tools: ["exec"], failures: 0}`,
`completion: {stopReason: "stop"}`, 모델 `nvidia/nemotron-3-super-120b-a12b`, `runner: "embedded"`.
그리고 실제로:

```
-rw-r--r-- 1 sandbox sandbox 9 … verified.txt
VERIFIED
```

**에이전트가 도구를 써서 파일을 만들었다.** 지시를 흉내 낸 답변이 아니라 실행이다.

---

## F4 — deny-by-default 실증 ✅

정책은 **호스트만이 아니라 바이너리로도** 제한한다. 이것이 문서만 읽고는 놓칠 부분이었다.

```yaml
network_policies:
  huggingface:
    endpoints:
      - {host: huggingface.co,        port: 443, protocol: rest, enforcement: enforce,
         rules: [{allow: {method: GET, path: /**}}]}
      - {host: cdn-lfs.huggingface.co, …}
      - {host: router.huggingface.co,  …}
    binaries:
      - {path: /usr/local/bin/python3}
      - {path: /usr/local/bin/node}
```

`/usr/local/bin/node`로 실행한 결과:

| 요청 | 결과 |
| --- | --- |
| `https://huggingface.co/api/papers/2501.12948` (정책 O) | **ALLOWED http=200** |
| `https://huggingface.co/api/users/julien-c/likes?limit=1` (정책 O) | **ALLOWED http=200** |
| `https://api.github.com/users/ohsuz` (정책 X) | **BLOCKED** |
| `https://example.com/` (정책 X) | **BLOCKED** |

그리고 **같은 호스트라도 바이너리가 다르면 막힌다**:

```
$ curl https://huggingface.co/api/papers/2501.12948
curl: (56) CONNECT tunnel failed, response 403
```

`curl`은 `huggingface` 정책의 바이너리 목록에 없다. `brew` 정책에만 있고, 그 정책이 여는 것은
`github.com`·`ghcr.io`·`raw.githubusercontent.com`이지 `api.github.com`이 아니다.

> **설계 함의:** TrialPlan이 쓰는 도구가 정책의 바이너리 목록과 맞아야 한다. "github.com을 열었다"가
> "내 스크립트가 github에 갈 수 있다"를 뜻하지 않는다. `config/nemoclaw/taste-inbox-sandbox.yaml`은
> endpoint와 binary를 **쌍으로** 선언해야 한다.
>
> baseline에 `api.github.com`이 없다는 문서상의 서술도 실측으로 확인됐다. 우리가 열어야 한다.

---

## F5 — AI-Q Research 실제 수행 ✅

```bash
cd aiq && uv sync
./scripts/start_as_skill.sh --config_file configs/config_web_default_llamaindex.yml --port 8010
```

```
$ AIQ_SERVER_URL=http://localhost:8010 python3.11 ~/.claude/skills/aiq-research/scripts/aiq.py health
{"status": "healthy", "dask_available": true, "db": "ok", "encryption": {"mode": "off", "ready": true}}

$ … aiq.py agents
{"agents": [{"agent_type": "deep_researcher",   "description": "Performs comprehensive multi-loop deep research"},
            {"agent_type": "shallow_researcher", "description": "Performs quick single-turn research"}]}
```

실제 조사 (`shallow_researcher`), 질의는 수집한 실제 저장소에 대한 것:

```
$ … aiq.py research "What is the TransBench benchmark from ATH-MaaS on GitHub, what problem
                     does it evaluate, and what would be the smallest runnable first step…"
{"job_id": "331e8e1a-b13b-4f4c-a60b-5ee6d56145b8", "has_report": true, "report": "…1,995자…"}
```

리포트는 TransBench가 무엇을 평가하는지(자동 오류 검출, 품질 점수 예측, no-post-edit 서브태스크,
저자원 언어 자막)와 **"smallest runnable first step"**을 실제로 답했다. 후자가 `TrialPlan`이 된다.

> **주의 하나:** 기동 로그에 `Dask is not available, async generation endpoints will not be added`가
> 찍혔지만 `/health`는 `dask_available: true`를 돌려주고 `/v1/jobs/async/agents`도 등록됐다.
> 비동기 딥리서치는 동작한다. `deep_researcher`로 장시간 작업을 돌릴 때 재확인할 것.

---

## 설계에 반영해야 할 정정

계획서 §3.2는 공개 문서를 근거로 썼고, **설치된 버전에는 그 명령이 없다.**

| 계획서가 적은 것 | 실제 (OpenClaw 2026.7.1) |
| --- | --- |
| `openclaw agent exec` | **그런 서브커맨드가 없다.** `openclaw agent`만 있다 |
| `--cwd <dir>` | 없다. `OpenClaw does not recognize option "--cwd"` → 셸에서 `cd` 한다 |
| `--state-dir <dir>` | 없다 |
| `--isolated`, `--code-mode`, `--fallback` | 없다 |
| (헤드리스 진입점으로) `--local` | **샌드박스 안에서 금지된다** (아래) |

```
$ openclaw agent --local …
Error: 'openclaw agent --local' is not supported inside NemoClaw sandboxes.
The --local flag bypasses the gateway's security protections (secret scanning,
network policy, inference auth) and can crash the sandbox.
Instead, run without --local to use the gateway's managed inference route:
  openclaw agent --agent main -m "hello"
```

**확정된 실제 호출 형태:**

```bash
nemoclaw <sandbox> exec --timeout <s> -- sh -lc '
  cd <workdir> && openclaw agent --agent main --json --timeout <s> --session-id <id> -m "<plan>"'
```

살아 있는 플래그: `--agent · -m/--message · --message-file · --json · --timeout · --session-id ·
--session-key · --model · --thinking · --verbose · --deliver · --channel`.

`--local`이 막힌 것은 **제약이 아니라 우리 설계의 근거**다. 게이트웨이를 통과해야만 secret
scanning·network policy·inference auth가 걸리고, 그게 이 제품이 OpenShell을 쓰는 이유 전체다.

---

## P0에 미치는 영향 (갱신)

| P0 항목 | 상태 |
| --- | --- |
| 5 (스킬 설치 + AI-Q 기동 + health) | ✅ 완료 |
| 6 (`nemoclaw onboard` + 정책) | ✅ 온보딩 완료 / 프리셋 적용은 남음 |
| 11 (research runner) | 런타임 검증됨 — 구현만 남음 |
| 12 (trial runner) | 런타임 검증됨 — **호출 형태를 위 표대로** 구현 |
| 14 (Focus Canvas) | 실데이터로 채울 수 있다 |
| 1~4, 7~10, 13, 15, 16 | 영향 없음 |

**프런트엔드 제약도 해소됐다.** Node 22가 설치되어 `pnpm install`·빌드·E2E가 가능하다.

## 재현 절차 (다른 기계에서)

1. Docker Desktop 설치 후 실행, **`docker context use default`**
2. Node 22+/pnpm/uv 설치
3. `git clone --depth 1 https://github.com/NVIDIA/skills.git` → 스킬 3종을 `~/.claude/skills/`로
4. `curl -fsSL https://www.nvidia.com/nemoclaw.sh | NEMOCLAW_… bash` (위 F2 형태)
5. `git clone https://github.com/NVIDIA-AI-Blueprints/aiq.git && cd aiq && uv sync`
6. `deploy/.env`에 `NVIDIA_API_KEY`·검색 키 → `./scripts/start_as_skill.sh --port 8010`
7. `aiq.py health`로 확인
