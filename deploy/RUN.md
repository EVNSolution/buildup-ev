# buildup-ev 운영 명령

배포 구조와 각 단계의 의미는 [`README.md`](./README.md)를 먼저 확인한다. 아래 `<프로필명>`은 각 사용자가 `aws configure --profile`에서 정한 로컬 이름이다.

## 1. 도구와 계정 확인

```bash
aws --version
session-manager-plugin --version
aws sts get-caller-identity --profile <프로필명>
```

jackey 계정이라면 마지막 ARN은 다음 사용자여야 한다.

```text
arn:aws:iam::902837199612:user/jackeydu@evnsolution.com
```

AWS CLI와 plugin이 없다면 [AWS CLI v2 설치](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), [Session Manager plugin 설치](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)를 따른다.

## 2. 정상 배포

권장 방법은 PR을 검토·병합하여 `main`에 반영하는 것이다. AWS 계정은 필요하지 않고 저장소 write 권한만 필요하다.

현재 `main`을 수동으로 재배포할 때만 다음을 사용한다.

```bash
gh workflow run deploy-ssm.yml --ref main
gh run watch
```

완료 후 공개 경로를 확인한다.

```bash
curl -fsS -o /dev/null -w 'frontend=%{http_code}\n' https://buildup-ev.cleversystem.ai/
curl -fsS https://buildup-ev.cleversystem.ai/api/healthz
curl -fsS https://buildup-ev.cleversystem.ai/api/readyz
```

정상값은 frontend `200`이며 health와 ready 응답의 `ok`가 `true`여야 한다. 배포 완료 판단에는 ready 응답의 `revision`이 배포한 source revision과 같은지도 확인한다.

## 3. 서버 접속과 상태 확인

```bash
aws ssm start-session \
  --profile <프로필명> \
  --region ap-northeast-2 \
  --target i-007f16861a396a936
```

접속 후:

```bash
sudo cat /opt/buildup-ev/active-slot
sudo pm2 ls
sudo systemctl status caddy --no-pager
sudo docker ps --filter name=buildup-ev-postgres
python3 -c 'import openpyxl; print(openpyxl.__version__)'
soffice --version
```

비밀값 없이 현재 릴리스 증거를 확인한다.

```bash
sudo python3 - <<'PY'
import json
from pathlib import Path
base = Path('/opt/buildup-ev')
slot = (base / 'active-slot').read_text().strip()
manifest = json.loads((base / 'manifests' / f'{slot}.json').read_text())
for key in ('slot', 'sourceRevision', 'lockfileSha256', 'schemaMigrationSha256', 'schemaMigrationCount', 'ssmParameterVersion', 'workflowRunId', 'actor', 'preparedAt'):
    print(f'{key}={manifest[key]}')
PY
```

## 4. PostgreSQL 로컬 터널

```bash
aws ssm start-session \
  --profile <프로필명> \
  --region ap-northeast-2 \
  --target i-007f16861a396a936 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["15432"]}'
```

터널이 열린 동안 로컬에서는 `127.0.0.1:15432`를 사용한다. DB 사용자·비밀번호·DB명은 `/buildup-ev/app-env`에서 확인하되 화면이나 로그에 출력하지 않는다.

## 5. 운영 환경값 조회·수정

환경값을 로컬 임시 파일로 내려받는다.

```bash
ENV_FILE="$(mktemp)"
chmod 600 "$ENV_FILE"
aws ssm get-parameter \
  --profile <프로필명> \
  --region ap-northeast-2 \
  --name /buildup-ev/app-env \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text > "$ENV_FILE"
```

필수값 이름만 확인한 뒤 편집한다. 값은 출력하지 않는다.

```bash
${EDITOR:-vi} "$ENV_FILE"
python3 deploy/validate-env.py "$ENV_FILE"
```

변경 전 버전을 기록하고 같은 SecureString에 덮어쓴다.

```bash
aws ssm get-parameter \
  --profile <프로필명> \
  --region ap-northeast-2 \
  --name /buildup-ev/app-env \
  --query 'Parameter.Version' \
  --output text

aws ssm put-parameter \
  --profile <프로필명> \
  --region ap-northeast-2 \
  --name /buildup-ev/app-env \
  --type SecureString \
  --overwrite \
  --value "file://$ENV_FILE"

rm -f "$ENV_FILE"
```

환경값은 다음 정상 배포부터 적용된다. GitHub Secret의 `APP_ENV`는 사용하지 않는다.

## 6. Prisma 스키마 변경

`schema.prisma`를 바꿀 때는 같은 PR에 migration SQL을 생성한다. 운영 DB에 직접 `db push`하지 않는다.

```bash
npm exec --workspace=backend -- prisma migrate dev \
  --name <변경이름> \
  --create-only
```

생성된 `backend/prisma/migrations/<시각>_<변경이름>/migration.sql`을 검토한다. 기존 active 슬롯이 계속 동작할 수 있도록 테이블·nullable 컬럼·인덱스를 먼저 추가하고, 삭제·이름 변경·타입 변경은 사용 중단 후 별도 배포로 미룬다.

개인정보 컬럼이나 테이블을 제거하는 별도 migration은 같은 디렉터리에 `privacy-preflight.audit`와 `privacy-preflight.sql`을 추가한다. SQL은 제거 대상 위반 건수 하나만 반환해야 한다. `migration.sql`에도 `-- privacy-abort-guard: <audit-id>` 표식과 같은 조건을 transaction 안에서 다시 확인해 중단시키는 SQL을 넣는다. 외부 감사 뒤 재기록되는 경쟁 조건은 이 내부 guard가 막는다. 차단 시 실제 행을 조회하거나 로그에 복사하지 말고 승인된 집계 query와 데이터 정리 절차를 고친 뒤 다시 검증한다.

PR이 병합되면 정상 배포가 다음을 자동 수행한다.

1. 미적용 migration 확인
2. 선언된 privacy preflight의 잔존 위반 0건 확인
3. `/opt/buildup-ev/shared/backups/schema-*.dump` 생성 및 `pg_restore -l` 검증
4. `prisma migrate deploy`
5. migration status와 전체 Prisma schema diff 확인
6. 기존 `db:drift` 확인
7. candidate 슬롯 기동

백업은 최근 10개를 유지한다. migration 실패 시 기존 active 슬롯은 유지되지만 DB 변경은 자동 역실행하지 않는다. 실패한 migration 파일을 수정하거나 `resolve --applied`로 우회하지 말고 Issue 전용 복구 runbook을 만든다.

### 기존 운영 DB baseline

Prisma Migrate 도입 당시의 한 번뿐인 절차다. 전체 DB→schema diff가 `deploy/baseline-expected-drift.sql`과 정확히 같을 때만 backup 후 baseline을 적용 표시한다.

```bash
sudo -s
cd /opt/buildup-ev/releases/<검증한-revision>
SOURCE_REVISION="$(git rev-parse HEAD)" deploy/baseline-existing-database.sh
```

`schema_baseline=already-applied` 이후에는 이 명령을 반복할 필요가 없다.

## 7. 장애 복구

- 배포 도중 실패: 기존 active 슬롯이 유지되므로 Actions 로그의 첫 실패 원인만 수정한다.
- 배포 후 코드 장애: 문제 커밋을 `git revert`하여 `main`에 반영하고 정상 배포를 다시 실행한다.
- 환경값 문제: Parameter Store의 직전 내용을 복원한 뒤 정상 배포를 다시 실행한다.
- DB 문제: 자동 롤백이 없으므로 `/opt/buildup-ev/shared/backups/`의 migration 직전 dump를 기준으로 전용 복구 runbook을 작성한다.
- 배포 결과 확인: active 슬롯 manifest의 source revision과 `/api/readyz` revision을 비교한다.

## 금지 사항

- PEM/SSH, rsync, `/srv/buildup-ev`, Docker Caddy 절차를 사용하지 않는다.
- 운영 `.env`, `DATABASE_URL`, JWT 비밀값, DB 비밀번호를 커밋하거나 터미널에 출력하지 않는다.
- 운영에서 `db:push`, `migrate dev`, `migrate reset`, `accept-data-loss`, `db:seed`, `bootstrap`을 실행하지 않는다.
- 개인 관리자 권한이 있어야만 실행되는 명령을 일반 운영 절차로 추가하지 않는다.
