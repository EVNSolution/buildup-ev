# 운영 배포 절차

## 서버 정보
- SSH: `ec2-user@43.201.61.182`
- PEM: repo 루트 `./BUILDUP-EV-key.pem` (chmod 400, **커밋 금지**)
- 앱 경로: `/srv/buildup-ev`
- Node: `/opt/node/bin`
- 도메인: `https://buildup-ev.cleversystem.ai`

## 컨테이너
- Postgres: `buildup-ev-postgres`
- Caddy: `buildup-ev-caddy`

## 배포 순서

### 1. 소스 rsync (로컬 → 서버)
```bash
rsync -avz --delete-after \
  --exclude=.git --exclude=node_modules --exclude=.env \
  --exclude=BUILDUP-EV-key.pem \
  --exclude=frontend/dist --exclude=backend/dist \
  -e "ssh -i ./BUILDUP-EV-key.pem" \
  ./ ec2-user@43.201.61.182:/srv/buildup-ev/
```

### 2. 서버 작업 (ssh 접속 후)
```bash
cd /srv/buildup-ev
PATH=/opt/node/bin:$PATH npm ci                                             # devDeps 포함 (ignore-scripts 쓰지 말 것)
PATH=/opt/node/bin:$PATH npm run --workspace=backend db:push                # 스키마 변경 시
PATH=/opt/node/bin:$PATH npx tsx backend/prisma/backfill-quote-no.ts       # 견적번호 backfill (1회성, 필요 시)
PATH=/opt/node/bin:$PATH npm run --workspace=frontend build                 # 프론트 빌드 (서버에서)
```

### 3. 재시작
```bash
sudo systemctl restart buildup-ev
sudo docker restart buildup-ev-caddy
```

### 4. 검증
```bash
curl -I https://buildup-ev.cleversystem.ai/login          # 200 OK
curl -i https://buildup-ev.cleversystem.ai/api/v1/auth/me # 401/403 JSON
```

## 주의
- 서버 `.env` 절대 수정 금지
- `.env`, `BUILDUP-EV-key.pem`, `DATABASE_URL` 커밋·출력 금지
- `npm ci`에 `--ignore-scripts` 쓰지 말 것 (prisma generate, bcrypt 빌드 필요)
- 빌드는 서버에서 (`npm run --workspace=frontend build`) — 로컬 dist rsync 방식 쓰지 말 것
