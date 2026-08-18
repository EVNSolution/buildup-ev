/**
 * 외부(WARP) 고객 export/link API — 역방향 수집(#191).
 *
 * 인증 계층(키 미설정 503 / 불일치 401)은 DB 없이 검증하고,
 * export·link 본동작은 DATABASE_URL 있을 때만 실 DB로 검증한다(기존 관례).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

const KEY = 'k'.repeat(64);
const shouldSkipDb = !process.env['DATABASE_URL'];

beforeEach(() => { vi.stubEnv('WARP_API_KEY', KEY); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('인증 — 키 미설정 503 / 불일치 401 (DB 불필요)', () => {
  const app = createApp();

  it('키 미설정 → 503 (기능 꺼짐을 키 오류와 구분)', async () => {
    vi.stubEnv('WARP_API_KEY', '');
    await request(app).get('/api/external/customers').expect(503);
  });

  it('키 없음·불일치 → 401', async () => {
    await request(app).get('/api/external/customers').expect(401);
    await request(app).get('/api/external/customers').set('x-api-key', 'wrong'.repeat(13)).expect(401);
    await request(app).post('/api/external/customers/link').send({ links: [] }).expect(401);
  });

  it('since 형식 오류 → 400', async () => {
    await request(app).get('/api/external/customers?since=not-a-date').set('x-api-key', KEY).expect(400);
  });

  it('link 본문 검증 — 배열 아님·빈 배열·필드 누락 → 400', async () => {
    const bads = [{}, { links: [] }, { links: [{ id: 'x', warp_customer_id: 'w' }] }, { links: [{ id: 1 }] }];
    for (const body of bads) {
      await request(app).post('/api/external/customers/link').set('x-api-key', KEY).send(body).expect(400);
    }
  });
});

describe.skipIf(shouldSkipDb)('export·link 동작 (실 DB)', () => {
  const app = createApp();

  it('export 는 화이트리스트 필드만 — created_by 미노출, since 증분·link write-back 동작', async () => {
    const created = await prisma!.customer.create({
      data: { name: '__external_test__', phone: '010-0000-1111', created_by: null },
      select: { id: true },
    });
    try {
      // 전체 export 에 포함되고 내부 필드는 없다
      const res = await request(app).get('/api/external/customers').set('x-api-key', KEY).expect(200);
      const row = (res.body.data as Array<Record<string, unknown>>).find(c => c['name'] === '__external_test__');
      expect(row).toBeTruthy();
      expect(row).not.toHaveProperty('created_by');
      expect(row).toHaveProperty('warp_customer_id', null);

      // 미래 시각 since → 빈 결과 (증분 필터)
      const future = new Date(Date.now() + 60_000).toISOString();
      const inc = await request(app).get(`/api/external/customers?since=${future}`).set('x-api-key', KEY).expect(200);
      expect((inc.body.data as unknown[]).length).toBe(0);

      // link write-back → warp_customer_id 저장. 없는 id 는 0건으로 집계된다
      const link = await request(app)
        .post('/api/external/customers/link')
        .set('x-api-key', KEY)
        .send({ links: [{ id: created.id, warp_customer_id: 'warp-cuid-test' }, { id: 999999999, warp_customer_id: 'x' }] })
        .expect(200);
      expect(link.body.data.updated).toBe(1);
      const after = await prisma!.customer.findUnique({ where: { id: created.id }, select: { warp_customer_id: true } });
      expect(after?.warp_customer_id).toBe('warp-cuid-test');
    } finally {
      await prisma!.customer.delete({ where: { id: created.id } });
    }
  });
});
