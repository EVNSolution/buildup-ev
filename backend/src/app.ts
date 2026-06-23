import express from 'express';
import cookieParser from 'cookie-parser';
import { injectJwtAuth } from './middleware/rbac.js';
import { modelsRouter } from './routes/models.js';
import { quotesRouter } from './routes/quotes.js';
import { loadCalcRouter } from './routes/load-calc.js';
import { ordersRouter } from './routes/orders.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { accessControlRouter } from './routes/access-control.js';
import { featureModulesRouter } from './routes/feature-modules.js';
import { subsidyRouter } from './routes/subsidy.js';
import { orgsRouter } from './routes/orgs.js';
import { regionsRouter } from './routes/regions.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // BigInt → Number (Prisma의 BigInt 컬럼이 JSON.stringify를 막는 문제 해결)
  app.set('json replacer', (_: string, v: unknown) => typeof v === 'bigint' ? Number(v) : v);
  app.use(injectJwtAuth);

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/access-control', accessControlRouter);
  app.use('/api/v1/feature-modules', featureModulesRouter);
  app.use('/api/v1/models', modelsRouter);
  app.use('/api/v1/quotes', quotesRouter);
  app.use('/api/v1/load-calc', loadCalcRouter);
  app.use('/api/v1/orders', ordersRouter);
  app.use('/api/v1/subsidy', subsidyRouter);
  app.use('/api/v1/orgs', orgsRouter);
  app.use('/api/v1/regions', regionsRouter);

  return app;
}
