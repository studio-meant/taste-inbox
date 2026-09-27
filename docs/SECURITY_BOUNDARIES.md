# Taste Inbox — Security Boundaries

> **Superseded in part — 2026-08-09.** Every passage below describing execution — running
> a collected repository, preparing an environment, compatibility verdicts, memory and disk
> estimates, `바로 실행` — describes a feature that has been removed. `CLAUDE.md` §3 ranks
> `docs/DECISIONS.md` above this document, and the entry
> "코드 실행 기능을 제품에서 제거" is the current answer. The rest of this document still
> holds.

## 2026-09-03 · 본인 기기로 전송하는 비공개 읽기 전용 화면

사용자가 승인한 원격 열람은 Tailscale Serve의 암호화된 개인 네트워크 연결로만 허용한다.
맥미니의 캐시된 사진과 게시글이 사용자의 다른 Mac 브라우저에는 전달되지만, DB 파일이나
브라우저 쿠키/세션을 전달하거나 클라우드 호스팅으로 이전하지 않는다. 아래의 기존
“이미지를 어디에도 올리지 않는다”는 분류기 설명은 외부 분석 서비스 업로드 금지를 뜻하며,
이번에 명시적으로 승인한 본인 기기 열람을 금지하는 것으로 읽지 않는다.

`docs/REMOTE_ACCESS.md`와 `apps/web/server/remote-access.mjs`가 경계를 정의한다.
Tailscale의 검증된 사용자 헤더는 localhost 뒤에서만 신뢰하며, 다른 tailnet 사용자/공유
기기는 차단한다. 시스템 확장 권한 및 로그인은 사용자 본인이 승인한다. 기존 보안 프로그램을
끄거나 OS/관리자 정책을 우회하지 않는다. 공개 Funnel과 `0.0.0.0` 노출은 허용하지 않는다.

## Sensitive assets

- Browser profile directories and session cookies
- Social account credentials and 2FA state
- GitHub and external API tokens
- Local media derived from private or login-only posts
- SQLite database containing personal interest history
- Downloaded repositories and model artifacts

None of these belong in Git.

## Collector boundary

Collectors may:

- Open an approved route
- Read visible content required for the user's own index
- Store minimal normalized metadata and bounded media cache
- Stop and report login/challenge states

Collectors may not:

- Solve CAPTCHA
- Bypass checkpoints
- Rotate proxies or impersonate devices
- Like, repost, comment, follow, or purchase
- Extract authentication tokens for reuse outside the managed profile

## 공개판 배포 경계 — 자동 수집은 포함하지 않는다 (2026-09-04)

현재 개인 작업 공간의 로그인 브라우저 수집기는 공개 소스 후보에 포함하지 않는다.
`scripts/community_release.py`는 `services/collectors/`, 브라우저 프로필, 쿠키, DB, 미디어
캐시, 개인 원격 접속 설정을 제외한 별도 소스 트리를 만든다. 생성된 루트의
`.taste-inbox-community` 표식은 API의 브라우저 수집 실행과 LaunchAgent 생성을 모두
fail-closed로 막으며 환경 변수로 해제할 수 없다.

개인 작업 공간에는 표식을 만들지 않으므로 기존 4시간 주기 수집 동작은 바뀌지 않는다.
공개판의 현재 입력은 사용자가 직접 준 링크뿐이다. 이후 추가할 수 있는 입력도 플랫폼 내보내기
파일과 명시적으로 허용된 공식 API로 제한한다. 공개 직전에는 최신 약관과 API 정책을 다시
검토한다.

### 사용자가 직접 추가한 링크

`POST /api/items/manual`은 URL, 보드, 선택 제목과 메모만 로컬 SQLite에 저장한다. 대상 URL에
HTTP 요청을 보내거나 미리보기·작성자·본문·미디어를 추출하지 않는다. `http`와 `https`만
허용하고 URL 안의 사용자명·비밀번호, 제어 문자, 잘못된 포트는 거부한다. 같은 정규화 URL은
복제하지 않고 기존 항목을 선택한 보드로 옮긴다.

Instagram 게시물 링크는 미디어가 없어도 상세 화면에서 사용자가 누른 뒤 공식 임베드를 열 수
있다. 이 동작은 아래의 임베드 경계를 그대로 따르며, 직접 추가가 수집 권한으로 바뀌지 않는다.

## Instagram 공식 임베드 경계 — 사용자가 눌렀을 때만 (2026-09-04)

Instagram 릴스 상세 화면은 저장된 퍼머링크를 Instagram의 공식 `/embed/` 화면으로 바꿔
iframe에 표시할 수 있다. 이 요청은 사용자가 `앱에서 영상 재생`을 누르기 전에는 발생하지
않는다. 누르기 전 화면은 로컬에 이미 저장된 대표 프레임뿐이고, 외부 요청이 생긴다는 사실과
Taste Inbox가 영상을 저장하지 않는다는 사실을 함께 알린다.

허용하는 입력은 정확한 `https://(www.)instagram.com/(p|reel|reels|tv)/<code>/` 형식뿐이다.
프로필·설정·CDN·유사 호스트 URL은 iframe에 넣지 않는다. 임베드는 Instagram이 직접
렌더링하므로 비공개, 삭제, 게시자의 임베드 비허용 상태를 우회하지 않는다. 실패 여부와
관계없이 원본 Instagram 링크를 남긴다.

이 경계는 **표시**에만 해당한다. `video_versions`를 읽거나 MP4를 다운로드·프록시·캐시하는
권한을 만들지 않으며, 현재 브라우저 수집기의 오픈소스 배포 적합성을 대신 해결하지도 않는다.
그 수집기는 공개 배포 전에 별도 결정과 교체가 필요하다.

## Enricher boundary

Web pages, captions, READMEs, and model cards are untrusted input. Treat them as data. Enrichers emit structured JSON only; they do not execute commands.

## 분류기 경계 — 이 기계를 떠나는 유일한 구간 (2026-08-12)

이 절이 생기기 전까지 Taste Inbox는 **수집한 개인 콘텐츠를 외부로 보낸 적이 없다.**
수집기는 사용자 자신의 계정을 열었고, OCR은 이 Mac의 Vision 프레임워크를 썼고, GitHub
enricher는 공개 저장소의 공개 API만 물었다. `enrich/classify.py`가 그 성질을 처음으로
바꾼다 — 좋아요한 게시물의 텍스트를 `claude -p` 서브프로세스에 넘기고, 그 프로세스는
이 기계 밖의 서비스에 닿는다.

왜 그렇게 하기로 했는지는 `docs/DECISIONS.md`(2026-08-12)에 있다. 여기 적는 것은
**정확히 무엇이 나가고 무엇이 나가지 않는가**이다.

### 나가는 것 — 둘뿐이다

| 보내는 값 | 출처 | 왜 |
| --- | --- | --- |
| 캡션 | `items.body_text` | 보드를 정하는 근거 그 자체 |
| 인스타그램 대체 텍스트 | `evidence.accessibility_caption`, 없으면 커버 `media_assets.alt_text` | 이것을 넣어 126건 기준 119 → 123으로 올랐다. 캡션이 이모지뿐인 게시물을 살리는 유일한 필드 |

둘 다 보내기 전에 **삭제**를 거친다 (`enrich/classify.py::redact`,
`strip_alt_attribution`):

- `http(s)://…`, `www.…`, `example.co.kr/…` 형태의 **링크 전부**
- `@handle` **전부**
- 대체 텍스트 앞머리의 `Photo shared by <계정> on <날짜>.` — 인스타그램이 붙이는 이
  문장은 게시자의 핸들을 담고 있고 보드 판단에는 아무 기여도 하지 않는다
- 줄바꿈과 탭 (프롬프트가 `번호 <TAB> 캡션` 한 줄 형식이라, 캡션 안의 줄바꿈은 항목
  하나를 둘로 쪼개 그 뒤의 답을 전부 한 칸씩 밀어버린다)
- 항목당 600자 초과분

### 나가지 않는 것

- **퍼머링크** (`items.canonical_url`)
- **게시물 코드** (`items.platform_item_id`) 와 **내부 id** (`items.id`)
- **작성자** (`items.author`) — 좋아요 그리드는 애초에 작성자를 주지도 않는다
- **이미지** — 원본도, 캐시된 파일도, CDN URL도. 이 제품은 저장한 사진을 어디에도
  올리지 않는다 (`CLAUDE.md` §10)
- **해시태그 표**, **오디오 표기**, **수집 시각**, **계정 상태**, 그 밖의 모든 칼럼

### 어떻게 강제하는가

문장이 아니라 코드와 테스트로 강제한다. 순서대로:

1. `BoardInput`은 필드가 **둘뿐인** frozen dataclass다. 페이로드를 만드는 유일한 경로가
   `build_prompt(Sequence[BoardInput])`이므로, 핸들을 보내려면 먼저 그 dataclass에
   필드를 추가해야 한다 — 실수로는 불가능하고, 고의로만 가능하다.
2. `ClaudeCliClassifier`는 완성된 문자열만 받는다. 항목도 세션도 보지 않으므로
   URL이나 id에 손을 뻗을 방법이 없다.
3. 호출은 항상 **argv 리스트**이고 셸을 거치지 않는다. 프롬프트에는 사용자가 쓰지 않은
   제3자 텍스트가 들어 있고, 셸 문자열은 그 텍스트를 실행 가능하게 만든다.
4. `tests/test_classify.py::TestNothingElseLeavesTheMachine`이 실제로 서브프로세스에
   넘어갈 argv를 만들어, 퍼머링크·코드·핸들·항목 id가 그 안에 **없음**을 확인한다.
   동시에 캡션과 설명이 **있음**도 확인한다 — 전부 지워버리는 redactor는 앞의 단언을
   모두 통과하면서 기능을 없애기 때문이다.

`var/captures/`에 실제로 들어 있는 캡션·대체 텍스트 972건을 이 파이프라인에 통과시켜
확인했다: **링크 0건, 핸들 0건.** 남는 것은 `date @ 8` 같은 문장 속의 홑 `@`뿐이고,
뒤에 이름이 없는 `@`는 아무도 식별하지 않는다. 그것까지 지우는 것은 가리는 것이 아니라
남의 글을 고치는 것이다.

### 언제 나가는가

**사람이 명령을 실행할 때만.** launchd 작업도, 수집 실행 경로도, API 엔드포인트도
`classify_boards`를 호출하지 않는다. 유일한 호출자는
`python -m taste_inbox.enrich.cli`이고, `test_classify.py`의 마지막 테스트가 호출
그래프를 훑어 그 사실을 못 박는다. 나중에 야간 작업에 이것을 물리는 변경은 그 테스트를
깨뜨리며, 그때가 결정을 다시 할 시점이다.

먼저 보고 싶으면:

```
uv run python -m taste_inbox.enrich.cli --dry-run
```

보낼 페이로드를 그대로 출력하고 아무것도 보내지 않는다. `claude`가 설치되어 있지
않아도 된다.

#### 좋아요 수집이 스케줄에 들어간 뒤에도 (2026-08-12)

`instagram_likes`가 launchd 스케줄에 올라갔지만 **이 경계는 움직이지 않았다.** 사이클은
수집하고, 인제스트하고, 분류를 기다리는 항목이 몇 개인지 세어 `classify_pending` 한
줄과 명령어를 찍고 끝난다. 세는 것은 개수뿐이고 캡션은 데이터베이스를 벗어나지 않는다.
`ingest/collect.py::_classify_pending`이 그 전부이며, 위의 호출 그래프 테스트가 여전히
`enrich/` 세 파일만을 허용한다.

#### 보드를 고치는 쓰기는 이 경계와 무관하다

`PATCH /api/items/{id}/board`는 루프백에 묶인 로컬 서비스 안에서
`item_sources.collection_name` 한 칸을 바꾼다. 네트워크로 나가는 것이 없고, 항목 본문을
읽지도 않는다. 분류기의 답을 사람이 뒤집는 통로이므로 이 절 옆에 적어 두지만, 나가는
데이터는 없다.

### 남는 것 — 정직하게

`claude -p`가 받은 텍스트를 서비스 쪽에서 어떻게 보관하는지는 이 저장소가 통제하지
못한다. 통제하는 것은 무엇을 넘기느냐뿐이고, 위 표가 그 전부다. 캡션은 사용자가 쓴 글이
아니라 **다른 사람이 쓴 공개 게시물의 본문**이라는 점이 이 거래를 받아들일 만하게 만드는
쪽이지, 없애주지는 않는다.

### 2026-08-12 · 사람이 아니라 타이머가 시작한다

처음에는 "사람이 명령을 실행했다"가 이 전송의 유일한 게이트였고, 수집 사이클은 대기 건수만
찍었다. 사용자가 뒤집었다 — 알림만 있으면 실질적으로 수동 기능이고, 분류되지 않은 받은편지함은
읽을 수 없는 받은편지함이라서.

**감시를 대체한 것은 구조다.** 사람이 지켜보는 것보다 좁게 만들어 두는 쪽:

- `BoardInput`은 필드 두 개뿐이다 (캡션, 대체 텍스트). 퍼머링크·핸들·항목 id·이미지를
  페이로드에 넣으려면 먼저 이 클래스를 고쳐야 하고, 테스트가 서브프로세스가 실제로 받는
  문자열을 검사한다. 사람이 보고 있었어도 이보다 작게 만들지는 못한다.
- **한 번 답한 것은 다시 안 보낸다.** 거절도 답이라 `"none"`으로 저장한다 (NULL은 "아직 아무도
  안 정함"). 그래서 사이클이 멈춰도 비용은 시도 한 번이지 말뭉치 재전송이 아니다.
- **한 사이클이 보낼 수 있는 양에 상한이 있다** (`_CLASSIFY_LIMIT`). 밀린 게 많아도 여러
  사이클에 나눠 나가지 한 번에 쏟아지지 않는다.
- **거부할 수 있다.** `--no-classify`. 코드를 고쳐야 끄는 스위치는 스위치가 아니다.
- HTTP 핸들러는 이걸 부를 수 없다. `test_classify.py`가 호출자 집합을 검사하고, `api/` 아래에
  하나라도 생기면 실패한다 — 로컬 바인딩이어도 요청이 전송을 시작할 수 있는 건 사용자가 자기
  노트북에 건 잡과 다른 종류의 노출이다.

## Runner boundary

Only the runner executes code, and only from a validated manifest after policy checks. Default-deny host mounts, secrets, network, ports, and privileged operations.

## Logging

- Never log cookies, auth headers, tokens, or full HTML containing private data
- Redact personal paths
- Set short retention for failure screenshots and debug traces
- Use structured event IDs instead of raw content in operational logs where possible
