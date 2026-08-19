# BUILDUP-EV 운영 보안 기준

## 운영 ENV

- 운영 애플리케이션 ENV의 단일 정본은 SSM SecureString `/buildup-ev/app-env`이다.
- GitHub Actions는 애플리케이션 ENV를 읽거나 쓰지 않는다. GitHub `APP_ENV`와 EC2 기존 `.env` fallback을 사용하지 않는다.
- EC2 슬롯의 `.env`는 SSM에서 생성되는 mode `0600` 런타임 사본이다.
- 배포 전 `deploy/validate-env.py`로 필수 키, 설정 쌍, URL, 중복 키를 검사한다. 값은 로그에 출력하지 않는다.
- `PORT`, `NODE_ENV`, `DOC_STORAGE_DIR`는 배포 스크립트가 소유한다. SSM 애플리케이션 ENV에 저장하지 않는다.
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PW`는 일회성 bootstrap 입력이다. 운영 런타임 ENV에 보관하지 않는다.

## 계정과 권한

- JWT의 서명이 유효해도 운영 요청은 DB의 현재 활성 계정과 역할을 다시 확인한다.
- 계정 저장소를 확인할 수 없으면 `503 AUTH_UNAVAILABLE`로 닫는다.
- 권한 저장소 조회가 실패하면 권한을 허용하지 않고 `503 PERMISSION_UNAVAILABLE`로 닫는다.
- `is_master`는 로컬 개발의 화면 전환 보조값이다. 운영에서 역할이나 권한 우회로 사용하지 않는다.
- 테스트 우회는 `NODE_ENV=test`와 명시적 `ALLOW_TEST_*_BYPASS=true`가 동시에 있을 때만 동작한다.
- 계정과 거래 기록은 삭제보다 비활성화와 상태 전이를 사용한다.

## 배포 신뢰 경계

- 외부 GitHub Action은 태그가 아니라 40자리 commit SHA로 고정한다.
- CI는 `npm audit --audit-level=high`로 High와 Critical 취약점이 있는 배포를 차단한다.
- AWS 접근은 GitHub OIDC 임시 자격증명만 사용하고 배포 job에만 `id-token: write`를 부여한다.
- 배포 대상은 workflow가 받은 정확한 source revision이며 `main`을 서버에서 다시 해석하지 않는다.
- 신규 슬롯이 DB readiness와 정확한 revision을 증명하기 전에는 Caddy 트래픽을 전환하지 않는다.
- 전환 후 내부 TLS 경로와 프론트를 확인한다. 실패하면 이전 Caddy 설정을 복원하고 신규 PM2 프로세스를 제거한다.

## 노출 제한

- health 응답은 상태, revision, slot만 반환한다.
- 배포 로그와 manifest에는 비밀값, DB URL, 인증 헤더, ENV 원문을 기록하지 않는다.
- 운영 ENV를 확인할 때는 키 존재 여부와 SSM 버전만 기록한다.

## 운영 반영 전 조건

현재 SSM 값에서 배포 소유 키와 bootstrap 키를 제거한 뒤 validator를 통과시켜야 한다. 또한 운영 관리자 계정이 `is_master` 우회가 아니라 명시적 `ADMIN` 역할과 필요한 AccessControl을 가지고 있는지 확인해야 한다. 이 정리는 실제 운영 변경이므로 로컬 코드 검증과 PR 검토가 끝난 후 승인된 운영 절차로 수행한다.

현재 lockfile 감사에서는 High와 Critical이 0건이다. React Router 6 계열의 Moderate 2건은 7 계열 전환이 필요한 breaking change라 이 배포 안정화 PR에서 강제 변경하지 않는다. 별도 프론트엔드 호환성 Issue #209에서 추적한다.
