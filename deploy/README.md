# buildup-ev deploy

PEM/SSH 없이 GitHub Actions → SSM으로 배포한다.

## GitHub secrets

- `AWS_REGION`
- `AWS_ROLE_ARN`
- `EC2_INSTANCE_ID`
- `SERVER_NAME`
- `APP_ENV` — 그대로 SSM SecureString `/buildup-ev/app-env`에 저장됨

`APP_ENV` 최소값:

```env
DATABASE_URL=postgresql://...
JWT_SECRET=...
NODE_ENV=production
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PW=
# RUN_DB_PUSH=1   # 분리된 DB일 때만
# RUN_DB_SEED=1   # 분리된 DB일 때만. 운영 공유 DB 금지
```

## 동작

1. 현재 active slot 반대편(`blue`/`green`)에 repo checkout
2. `.env`를 SSM SecureString에서 복원
3. `npm ci`, Prisma client generate, frontend build
4. 새 slot backend를 새 포트에서 PM2 기동
5. `/api/v1/auth/me`가 `403` 또는 `200`이면 Caddy를 새 slot으로 전환
6. 실패하면 기존 active slot/Caddy 설정은 그대로 둠

Backend `tsc`는 현재 main에서 실패하므로 배포는 기존 실행 경로인 `tsx backend/src/server.ts`를 쓴다.
