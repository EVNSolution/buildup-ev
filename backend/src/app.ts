import express from 'express';
import { modelsRouter } from './routes/models.js';
import { quotesRouter } from './routes/quotes.js';
import { loadCalcRouter } from './routes/load-calc.js';
import { ordersRouter } from './routes/orders.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/api/v1/models', modelsRouter);
  app.use('/api/v1/quotes', quotesRouter);
  app.use('/api/v1/load-calc', loadCalcRouter);
  app.use('/api/v1/orders', ordersRouter);

  return app;
}
