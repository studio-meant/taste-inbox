# Taste Inbox Community 배포 경계

이 문서는 나중에 공개 저장소나 설치 파일을 만들 때 지켜야 할 최소 배포 경계다. 현재 개인용
작업 공간을 그대로 공개하지 않는다. 공개 후보는 반드시 `scripts/community_release.py`가 만든
별도 디렉터리에서 시작한다.

## 공개판에 들어가는 것

- 로컬 SQLite 인덱스와 읽기 화면
- 사용자가 직접 제공한 링크를 외부 조회 없이 저장하는 입력 경계
- 저장된 Instagram 퍼머링크를 사용자가 누른 뒤에만 불러오는 공식 임베드
- 샘플 데이터와 화면·API·데스크톱 앱 소스

## 공개판에서 빠지는 것

- `services/collectors/` 전체와 Playwright 로그인 프로필 처리 코드
- 실제 계정 핸들·Saved collection id·쿠키·DB·미디어 캐시·실패 캡처
- 개인 Tailscale 주소와 이 Mac에 등록된 LaunchAgent
- Instagram·Threads·LinkedIn의 사람용 화면을 예약 탐색하는 작업

공개 후보 루트에는 `.taste-inbox-community`가 생성된다. API는 이 표식을 보면 별도의 수집기
패키지가 나중에 복사되어도 브라우저 자동화 실행과 LaunchAgent 생성을 거부한다. 이 표식은
환경 변수로 해제할 수 없다.

## 플랫폼별 공개 입력 원칙

- **Instagram / Threads:** 현재는 사용자가 직접 붙여 넣은 퍼머링크만 받는다. 후속 입력은 공식
  API가 허용한 계정·범위나 플랫폼 내보내기 파일로 제한하며 사람용 로그인 화면을 자동 탐색하지
  않는다.
- **LinkedIn:** 사람용 웹 화면 수집기는 공개판에 넣지 않는다. 사용자가 직접 내보낸 데이터나
  명시적으로 승인된 API가 생긴 경우에만 별도 어댑터를 추가한다.
- **GitHub:** 브라우저 대신 인증 사용자의 Star 목록을 제공하는 공식 REST API로 교체한다.

이 경계는 법률 자문이 아니라 제품의 보수적인 배포 기준이다. 공개 직전에는 각 플랫폼의 최신
약관과 API 정책을 다시 확인한다.

## 후보 만들기와 검사

```bash
pnpm community:release
pnpm community:verify
```

결과는 `dist/taste-inbox-community-source/`에 만들어진다. 생성기는 Git에 올릴 수 있는 소스만
복사하고 개인 수집기, 런타임 데이터, 원격 접속 설정을 제외한 뒤 파일 해시 목록을 남긴다.
검사가 실패한 후보는 공개하지 않는다.
