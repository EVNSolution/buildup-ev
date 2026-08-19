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
for key in ('slot', 'sourceRevision', 'lockfileSha256', 'ssmParameterVersion', 'workflowRunId', 'actor', 'preparedAt'):
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

## 6. 스키마 변경이 반드시 필요할 때

일반 배포에서는 실행하지 않는다. 먼저 3번으로 서버에 접속하고 DB dump를 만든다.

```bash
sudo -s
mkdir -p /opt/buildup-ev/shared/backups
chmod 700 /opt/buildup-ev/shared/backups
docker exec buildup-ev-postgres pg_dump -U buildup -d buildup_ev -Fc > "/opt/buildup-ev/shared/backups/buildup_ev_$(date +%Y%m%d-%H%M%S).dump"
```

그 다음 변경 컬럼과 rollback이 명시된 Issue 전용 SQL runbook을 검토해 실행한다. 운영에서 `prisma db push`, `migrate reset`, `db:seed`를 사용하지 않는다. `RUN_DB_PUSH`, `RUN_DB_SEED` 환경변수로 배포와 묶지도 않는다.

## 7. 장애 복구

- 배포 도중 실패: 기존 active 슬롯이 유지되므로 Actions 로그의 첫 실패 원인만 수정한다.
- 배포 후 코드 장애: 문제 커밋을 `git revert`하여 `main`에 반영하고 정상 배포를 다시 실행한다.
- 환경값 문제: Parameter Store의 직전 내용을 복원한 뒤 정상 배포를 다시 실행한다.
- DB 문제: 자동 롤백이 없으므로 스키마 작업 전에 만든 dump를 기준으로 판단한다.
- 배포 결과 확인: active 슬롯 manifest의 source revision과 `/api/readyz` revision을 비교한다.

## 금지 사항

- PEM/SSH, rsync, `/srv/buildup-ev`, Docker Caddy 절차를 사용하지 않는다.
- 운영 `.env`, `DATABASE_URL`, JWT 비밀값, DB 비밀번호를 커밋하거나 터미널에 출력하지 않는다.
- 정상 배포에서 `db:push`, `db:seed`, `bootstrap`, OS 패키지 설치를 실행하지 않는다.
- 개인 관리자 권한이 있어야만 실행되는 명령을 일반 운영 절차로 추가하지 않는다.
