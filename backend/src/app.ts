import express from 'express';
import cookieParser from 'cookie-parser';
import { injectJwtAuth } from './middleware/rbac.js';
import { modelsRouter } from './routes/models.js';
import { quotesRouter } from './routes/quotes.js';
import { customersRouter } from './routes/customers.js';
import { loadCalcRouter } from './routes/load-calc.js';
import { ordersRouter } from './routes/orders.js';
import { stepsRouter } from './routes/steps.js';
import { docsRouter } from './routes/docs.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { accessControlRouter } from './routes/access-control.js';
import { weightConstantsRouter } from './routes/weight-constants.js';
import { optionDbRouter } from './routes/option-db.js';
import { statsRouter } from './routes/stats.js';
import { contractsRouter } from './routes/contracts.js';
import { tuningRouter } from './routes/tuning.js';
import { webhooksRouter } from './routes/webhooks.js';
import { emailRouter } from './routes/email.js';
import { featureModulesRouter } from './routes/feature-modules.js';
import { subsidyRouter } from './routes/subsidy.js';
import { orgsRouter } from './routes/orgs.js';
import { regionsRouter } from './routes/regions.js';
import { publicRouter } from './routes/public.js';

export function createApp() {
  const app = express();

  /*
   * ⚠️ **프록시를 신뢰한다고 알려 줘야 접속자를 구분할 수 있다.**
   *
   * 운영에서는 Caddy 가 앞에 서고 백엔드는 127.0.0.1 로만 요청을 받는다. 이 설정이 없으면
   * Express 는 모든 요청의 IP 를 **127.0.0.1 하나**로 본다 — 그러면 공개 상담 신청 제한
   * (시간당 5건)이 접속자별이 아니라 **전체 합계**가 되어, 한 시간에 여섯 번째 고객은
   * 아무 잘못 없이 막힌다. 조회 제한(분당 120)도 마찬가지로 방문자 몇 명이 함께 쓰면 걸린다.
   * express-rate-limit 이 기동 때마다 경고를 찍고 있었는데, 그게 이 상태를 가리킨 것이다.
   *
   * 'loopback' 으로 좁힌다 — 신뢰하는 것은 **우리 Caddy 한 홉**뿐이고,
   * 바깥에서 보낸 X-Forwarded-For 를 그대로 믿지 않는다.
   */
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use(cookieParser());
  // BigInt → Number (Prisma의 BigInt 컬럼이 JSON.stringify를 막는 문제 해결)
  app.set('json replacer', (_: string, v: unknown) => typeof v === 'bigint' ? Number(v) : v);
  app.use(injectJwtAuth);

  // 공개(비로그인) — 카탈로그 조회·계산·상담 접수만. 기존 라우트는 그대로 잠겨 있다.
  app.use('/api/v1/public', publicRouter);

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/access-control', accessControlRouter);
  app.use('/api/v1/weight-constants', weightConstantsRouter);
  app.use('/api/v1/option-db', optionDbRouter); // 기준데이터 CRUD + 감사이력 (ADMIN 전용)
  app.use('/api/v1/stats', statsRouter);        // 영업 성과 (SALES=본인만 / ADMIN=전체)
  app.use('/api/v1/feature-modules', featureModulesRouter);
  app.use('/api/v1/models', modelsRouter);
  app.use('/api/v1/quotes', quotesRouter);
  app.use('/api/v1/customers', customersRouter); // 고객 마스터 완전일치 조회(자동 기입)
  app.use('/api/v1/load-calc', loadCalcRouter);
  app.use('/api/v1/orders', ordersRouter);
  app.use('/api/v1/orders', docsRouter);
  app.use('/api/v1/orders', stepsRouter);
  app.use('/api/v1/quotes', contractsRouter); // 계약은 견적 기준
  app.use('/api/v1/orders', tuningRouter);   // 튜닝신청서는 주문 기준(등록증이 나온 뒤에 만든다)
  app.use('/api/v1/quotes', emailRouter);     // 견적서·계약서 이메일 발송
  app.use('/api/v1/webhooks', webhooksRouter);
  app.use('/api/v1/subsidy', subsidyRouter);
  app.use('/api/v1/orgs', orgsRouter);
  app.use('/api/v1/regions', regionsRouter);

  return app;
}
