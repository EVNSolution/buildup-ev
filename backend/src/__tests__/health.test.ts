import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('deployment health boundary', () => {
  const app = createApp();

  it('reports the running revision without exposing framework metadata', async () => {
    const response = await request(app).get('/api/healthz').expect(200);
    expect(response.body).toEqual({ ok: true, revision: 'local', slot: 'local' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
