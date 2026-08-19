# BUILDUP-EV 변경 통제

## 책임과 우선순위

- 이 저장소에서 `OziinG`의 지시, 작업 중인 변경, Issue, PR이 최우선 문맥이다.
- 공개 Issue, PR, Commit에는 실제 작업자 `OziinG`만 남긴다. 사용한 도구나 에이전트 이름을 작성자처럼 표시하지 않는다.
- 외부 시스템의 세션, 에이전트 지침, 소유권 문서를 자동으로 덮어쓰지 않는다.

## 질문 없이 진행할 작업

다음 작업은 안전하고 되돌릴 수 있는 일상 절차이므로 별도 확인 없이 수행한다.

- 읽기 전용 조사, `git fetch`, 상태 확인
- 깨끗한 `main`의 fast-forward 갱신
- 최신 `origin/main` 기준 작업 브랜치 생성
- 로컬 코드 수정, 테스트, 문서 갱신
- OziinG가 요청한 Issue와 PR의 증거 보강

다음 경우에만 작업을 멈춘다.

- OziinG의 미커밋 변경을 덮어쓸 가능성이 있는 경우
- 운영 직접 변경, 비밀값 조회 또는 출력, 운영 데이터 변경이 필요한 경우
- 삭제나 되돌리기 어려운 외부 상태 변경이 필요한 경우

## Git 절차

1. `git status`로 로컬 변경을 확인한다.
2. 깨끗한 경우 `git fetch origin` 후 `origin/main`을 기준으로 짧은 작업 브랜치를 만든다.
3. Issue에 목적, 범위, 기준 revision, 운영 전제조건을 남긴다.
4. 구현과 로컬 검증을 마친 뒤 하나의 의사결정 단위로 커밋한다.
5. Draft PR을 만들고 Issue를 연결한다.
6. 검토가 끝나면 squash merge한다.

## 릴리스 식별

BUILDUP-EV는 컨테이너 이미지가 아니라 EC2의 PM2 blue-green 슬롯에서 소스를 빌드한다. 따라서 이미지 digest를 흉내 내지 않고 다음 네 값을 배포 증거로 사용한다.

| 증거 | 의미 |
| --- | --- |
| Source revision | 실제 checkout한 40자리 Git SHA |
| Lockfile SHA-256 | 설치 의존성 입력인 `package-lock.json` 해시 |
| Migration SHA-256 | 적용 대상 migration SQL과 provider lock의 결합 해시 |
| SSM parameter version | 운영 애플리케이션 ENV의 적용 버전 |
| Workflow run ID | 배포 명령을 시작한 GitHub Actions 실행 |

서버는 슬롯별 manifest와 append-only `deploy-evidence.jsonl`에 이 값을 남긴다. 배포 성공 판단은 GitHub 표시나 브랜치 이름이 아니라 활성 슬롯의 `/api/readyz` revision 일치로 한다.

## DB 변경 통제

1. `schema.prisma` 변경과 `backend/prisma/migrations/` SQL을 같은 Issue와 PR에 넣는다.
2. migration SQL에서 destructive DDL과 데이터 변환을 분리하고, 이전 active 슬롯과 호환되는지 검토한다.
3. CI에서 migration history와 배포 순서 계약을 검증한다.
4. 운영 배포는 미적용 migration이 있을 때만 backup을 만들고, `prisma migrate deploy` 이후 전체 schema diff를 확인한다.
5. migration 이름, checksum, backup 경로, workflow run과 source revision을 운영 증거로 연결한다.

운영 DB 수동 SQL은 장애 복구나 이미 적용된 hotfix를 migration history와 화해시키는 경우에만 허용한다. 그 경우에도 Issue 전용 SQL, backup, 적용자, 적용 시각, `migrate resolve` 판단을 남긴다.

## 커밋 기록

커밋은 변경 목록보다 결정 이유를 먼저 적는다. 제약, 거절한 대안, 검증 결과, 미검증 범위를 trailer로 남긴다. 비밀값, 운영 ENV 원문, 임시 비밀번호는 어떤 Git 기록에도 넣지 않는다.
