# buildup-ev 배포 구조

이 문서가 배포 구조의 기준이다. 실제 명령은 [`RUN.md`](./RUN.md)를 사용한다.

## 원칙

- 배포는 `main` 반영 → GitHub Actions → AWS OIDC → SSM Run Command 한 경로만 사용한다.
- SSH, PEM, 로컬 빌드 산출물 업로드는 사용하지 않는다.
- 운영 환경값의 원본은 SSM SecureString `/buildup-ev/app-env` 하나다.
- 배포 대상은 workflow가 받은 40자리 Git SHA 하나다. 서버에서 `main`을 다시 해석하지 않는다.
- 일반 배포는 검토·커밋된 Prisma migration만 적용한다. DB push, seed, 관리자 bootstrap, OS 패키지 설치는 실행하지 않는다.
- 서버 준비는 인스턴스당 한 번, 애플리케이션 배포는 변경마다 실행한다.
- 실패한 신규 슬롯은 트래픽을 받지 않으며 기존 슬롯을 유지한다.
- 이미지 digest 대신 source revision, lockfile SHA-256, migration SHA-256, SSM version, workflow run ID를 릴리스 증거로 사용한다.

## 현재 구성

| 항목 | 값 |
|---|---|
| AWS 계정 | `902837199612` |
| 리전 | `ap-northeast-2` |
| 인스턴스 | `i-007f16861a396a936` |
| 앱 경로 | `/opt/buildup-ev` |
| 환경 파라미터 | `/buildup-ev/app-env` |
| 배포 역할 | `BuildupEvGitHubDeployRole` |
| 운영자 그룹 | `BuildupEvInstanceAccess` |
| 도메인 | `https://buildup-ev.cleversystem.ai` |
| DB | EC2 내부 Docker `buildup-ev-postgres` |

GitHub Actions Secret은 다음 네 개만 사용한다.

- `AWS_REGION`
- `AWS_ROLE_ARN`
- `EC2_INSTANCE_ID`
- `SERVER_NAME`

`APP_ENV` GitHub Secret은 사용하지 않는다. GitHub Actions는 운영 환경값을 읽거나 쓰지 않고 배포 명령만 전달한다.

## 사용자와 필요한 기술·권한

| 과정 | 의미 | 일반 담당자에게 필요한 것 |
|---|---|---|
| PR 병합 또는 `main` push | 정상 배포 시작 | Git/GitHub, 저장소 write 권한. AWS 계정 불필요 |
| Actions 수동 재실행 | 현재 `main` 재배포 | GitHub Actions 실행 권한. AWS CLI 불필요 |
| 서버 상태 확인 | PM2, Caddy, 파일, Docker 확인 | AWS CLI, Session Manager plugin, `BuildupEvInstanceAccess` |
| DB 포트 포워딩 | 로컬 도구/에이전트에서 EC2 내부 PostgreSQL 연결 | AWS CLI, Session Manager plugin, DB 사용자 정보 |
| 운영 환경값 조회·수정 | SSM SecureString을 내려받아 수정 후 재배포 | AWS CLI, `BuildupEvInstanceAccess`의 해당 파라미터 Get/Put |
| DB 스키마 변경 | migration SQL 작성·검토 후 PR 병합 | Prisma migration과 expand-contract 지식. 정상 반영에는 AWS 계정 불필요 |
| IAM 사용자/그룹 변경 | 운영자 추가·회수 | IAM 관리자. 일반 배포 작업이 아님 |

운영 절차는 개인 관리자 권한을 전제로 하지 않는다. `jackeydu@evnsolution.com`을 포함한 운영자는 `BuildupEvInstanceAccess`만으로 서버, DB 터널, 명령 실행, 운영 환경 파라미터 관리를 할 수 있어야 한다. GitHub 저장소 권한은 AWS IAM과 별도다.

## 정상 배포 순서와 의미

1. **코드 검토 후 `main` 반영**
   - 배포 대상을 Git 이력으로 고정한다.
   - `main` push 또는 수동 `workflow_dispatch`만 배포를 시작한다.
2. **GitHub OIDC로 임시 AWS 자격증명 발급**
   - 장기 AWS Access Key를 GitHub에 저장하지 않는다.
   - 역할 신뢰 정책은 이 저장소의 `main` 브랜치만 허용한다.
3. **SSM Run Command 전달**
   - GitHub runner는 지정 인스턴스에 배포 명령을 보내고 완료 상태만 읽는다.
   - 운영 환경값은 이 단계에서 전송하지 않는다.
4. **인스턴스 준비 확인**
   - `/opt/buildup-ev/.setup-complete`가 없을 때만 `setup-deploy.sh`를 실행한다.
   - Python, openpyxl, LibreOffice가 없으면 문서 기능을 조용히 끄지 않고 배포를 중단한다.
5. **반대 blue-green 슬롯 준비**
   - 현재 active 슬롯의 반대편에 workflow가 전달한 정확한 source revision을 checkout한다.
   - SSM SecureString의 값과 version을 읽고 ENV 계약을 검증한 뒤 mode `0600` `.env`로 복원한다.
6. **의존성·Prisma migration·프론트 빌드**
   - `npm ci`, `prisma generate` 후 미적용 migration을 확인한다.
   - migration이 있으면 PostgreSQL custom-format backup을 만들고 `pg_restore -l`로 읽을 수 있는지 검증한다.
   - `prisma migrate deploy` 후 migration status, 전체 Prisma schema diff, 기존 `db:drift`를 모두 확인한다.
   - `db:push`, `migrate dev`, `migrate reset`, `db:seed`, `bootstrap`은 운영에서 수행하지 않는다.
7. **신규 백엔드 기동과 readiness 확인**
   - PM2로 신규 포트에 실행한다.
   - `/api/readyz`가 DB 연결과 정확한 source revision을 증명해야 다음 단계로 간다.
8. **Caddy 전환과 외부 확인**
   - Caddy 설정을 검증하고 신규 슬롯으로 reload한다.
   - TLS 경로의 `/api/readyz`와 프론트가 정상일 때만 active 슬롯을 기록한다.
   - 실패하면 이전 Caddy 설정을 복원하고 신규 프로세스를 제거한다.
9. **배포 증거 기록**
   - `/opt/buildup-ev/manifests/<slot>.json`에 슬롯 manifest를 기록한다.
   - `/opt/buildup-ev/deploy-evidence.jsonl`에 준비 차단, 롤백, 활성화 결과를 append-only로 기록한다.

## DB와 운영 환경 변경

- 스키마 변경은 `backend/prisma/migrations/`의 forward-only SQL로 코드와 함께 검토한다. 배포는 candidate 기동 전에 backup과 `migrate deploy`를 실행한다.
- migration은 이전 active 코드와 새 candidate 코드가 동시에 사용할 수 있어야 한다. 삭제·이름 변경·타입 변경은 사용 중단과 데이터 이관이 끝난 별도 revision으로 미룬다.
- `db/schema/`의 기존 SQL은 baseline 이전 이력 참고용이다. 신규 운영 변경의 적용 이력은 Prisma migration ledger만 사용한다.
- `db:seed`는 권한 기준 테이블을 다시 생성하므로 정상 배포에서 실행하지 않는다.
- 운영 환경 변경은 기존 파라미터를 안전한 임시 파일로 내려받아 수정하고 같은 경로에 덮어쓴 뒤 정상 배포를 재실행한다.
- 환경값, `DATABASE_URL`, JWT 비밀값, DB 비밀번호를 콘솔·문서·커밋에 출력하지 않는다.

## 실패와 복구

- 빌드, 신규 API 상태 확인, Caddy 검증 중 실패하면 active 슬롯 기록을 바꾸지 않는다.
- 코드 문제로 배포 후 장애가 확인되면 해당 Git 커밋을 revert하여 `main`에 반영하고 동일한 배포 레인을 다시 사용한다.
- DB migration은 자동으로 역실행하지 않는다. 미적용 migration이 있으면 먼저 검증된 dump를 만들며, 장애 시 active 슬롯을 유지하고 해당 dump와 전용 복구 runbook으로 판단한다.
- 운영 환경 변경 전후에는 Parameter Store 버전을 기록한다.

## 책임 경계

- 배포 안정성과 내부 계정·권한 기준은 [`docs/security/SECURITY_MODEL.md`](../docs/security/SECURITY_MODEL.md)를 따른다.
- 변경 주체와 Git 증거 규칙은 [`docs/operations/CHANGE_CONTROL.md`](../docs/operations/CHANGE_CONTROL.md)를 따른다.
- 외부 API 계약은 이번 배포 안정화 범위가 아니다. HQ 이관 경계는 [`docs/security/HQ_HANDOFF.md`](../docs/security/HQ_HANDOFF.md)에만 기록한다.

## 공식 근거

- [GitHub Actions OIDC로 AWS 접근](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [GitHub OIDC 토큰과 `id-token: write`](https://docs.github.com/en/actions/reference/security/oidc)
- [AWS IAM: GitHub 저장소·브랜치로 OIDC 역할 제한](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)
- [GitHub Actions workflow와 trigger](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)
- [GitHub Actions 수동 실행과 write 권한](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [AWS Systems Manager Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [SSM Parameter Store SecureString 조회](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [SSM SecureString 생성·수정](https://docs.aws.amazon.com/systems-manager/latest/userguide/param-create-cli.html)
- [Prisma production migration 배포](https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate)
- [Prisma 기존 DB baselining](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining)
- [AWS CLI v2 설치](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [Session Manager plugin 설치](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
