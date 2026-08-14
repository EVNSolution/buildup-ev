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
import { webhooksRouter } from './routes/webhooks.js';
import { emailRouter } from './routes/email.js';
import { featureModulesRouter } from './routes/feature-modules.js';
import { subsidyRouter } from './routes/subsidy.js';
import { orgsRouter } from './routes/orgs.js';
import { regionsRouter } from './routes/regions.js';
import { publicRouter } from './routes/public.js';

export function createApp() {
  const app = express();
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
  app.use('/api/v1/quotes', emailRouter);     // 견적서·계약서 이메일 발송
  app.use('/api/v1/webhooks', webhooksRouter);
  app.use('/api/v1/subsidy', subsidyRouter);
  app.use('/api/v1/orgs', orgsRouter);
  app.use('/api/v1/regions', regionsRouter);

  return app;
}
