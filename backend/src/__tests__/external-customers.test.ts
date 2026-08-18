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

describe.skipIf(shouldSkipDb)('문서 제공 — 견적서·계약서 (실 DB)', () => {
  const app = createApp();

  it('잘못된 id → 400 / 체결 계약 없음 → 404', async () => {
    await request(app).get('/api/external/quotes/abc/quote-pdf').set('x-api-key', KEY).expect(400);
    await request(app).get('/api/external/quotes/999999999/contract-pdf').set('x-api-key', KEY).expect(404);
  });

  it('고정된 견적서가 있으면 그 파일을 그대로 준다 (즉석 렌더 없이)', async () => {
    const { mkdtemp, writeFile: wf, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const dir = await mkdtemp(pathMod.join(os.tmpdir(), 'warp-doc-'));
    const frozenPath = pathMod.join(dir, 'frozen_quote.pdf');
    await wf(frozenPath, '%PDF-frozen-test');
    const quote = await prisma!.quote.create({
      data: {
        model_code: 'PV5_OPENBED', selections: {}, inputs: {}, supply_price: 1, final_price: 1,
        status: 'confirmed', docs_frozen_at: new Date(), docs_frozen_quote_path: frozenPath,
      },
      select: { id: true },
    });
    try {
      const res = await request(app)
        .get(`/api/external/quotes/${quote.id}/quote-pdf`)
        .set('x-api-key', KEY)
        .expect(200)
        .expect('Content-Type', /application\/pdf/);
      expect(res.body.toString()).toBe('%PDF-frozen-test');
    } finally {
      await prisma!.quote.delete({ where: { id: quote.id } });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('체결된 계약서(서면 스캔 포함)를 확장자에 맞는 타입으로 준다', async () => {
    const { mkdtemp, writeFile: wf, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const dir = await mkdtemp(pathMod.join(os.tmpdir(), 'warp-doc-'));
    const signedPath = pathMod.join(dir, 'contract_paper_1.jpg');
    await wf(signedPath, 'jpg-bytes');
    const quote = await prisma!.quote.create({
      data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, supply_price: 1, final_price: 1, status: 'contracted' },
      select: { id: true },
    });
    const contract = await prisma!.purchaseContract.create({
      data: {
        quote_id: quote.id, signing_method: 'PAPER', status: 'COMPLETED',
        customer_snapshot: {}, signed_pdf_path: signedPath, completed_at: new Date(),
      },
      select: { id: true },
    });
    try {
      await request(app)
        .get(`/api/external/quotes/${quote.id}/contract-pdf`)
        .set('x-api-key', KEY)
        .expect(200)
        .expect('Content-Type', /image\/jpeg/);
    } finally {
      await prisma!.purchaseContract.delete({ where: { id: contract.id } });
      await prisma!.quote.delete({ where: { id: quote.id } });
      await rm(dir, { recursive: true, force: true });
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
