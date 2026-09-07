import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { authCookie } from './helpers.js';

/**
 * **남의 견적은 열리지 않는다.**
 *
 * 목록과 견적서 PDF 에는 담당 검사가 있었는데 **같은 자료를 주는 다른 경로에는 없었다.**
 * 실제로 남의 견적을 200 으로 받아 고객명·전화·이메일·주소·실구매가를 확인했다(전수조사).
 * 계약서 발송·취소처럼 **쓰는** 경로까지 비어 있었다 — 남의 계약서를 고객에게 보낼 수 있었다.
 *
 * 규칙은 하나다(`ownQuotesOnly`):
 *   · **영업 권한만** 있는 계정 → 자기 담당 건만
 *   · **관리자 권한이 있으면** → 전부(관제하는 자리다)
 */
const app = createApp();
const live = !!prisma;

const OWNER = 'demo-sales@local';
const OTHER = 'sales@evnsolution.com';      // 실재하는 다른 영업 — 담당이 아니다
const other = authCookie(OTHER, 'SALES', 'ORG_SALES1');
const admin = authCookie('demo-admin@local', 'ADMIN', 'ORG_HQ');

/** 담당이 정해진 견적 하나 — 남이 넘볼 대상 */
async function targetQuote(): Promise<number> {
  const q = await prisma!.quote.findFirst({
    where: { sales_user_id: OWNER }, select: { id: true }, orderBy: { id: 'desc' },
  });
  expect(q, '시험할 견적이 없다').not.toBeNull();
  return q!.id;
}

describe.runIf(live)('남의 견적 접근', () => {
  it('🔴 견적 상세가 열리지 않는다 — 고객 개인정보가 실려 있다', async () => {
    const id = await targetQuote();
    const res = await request(app).get(`/api/v1/quotes/${id}`).set('Cookie', other);
    expect(res.status, '남의 견적이 열렸다').toBe(403);
    // 막혔는데 본문에 값이 실려 나가면 막은 것이 아니다
    expect(JSON.stringify(res.body)).not.toMatch(/customer|phone|final_price/);
  });

  it('🔴 계약서를 대신 발송·취소하지 못한다', async () => {
    const id = await targetQuote();
    for (const path of ['/contract/send', '/contract/cancel', '/contract/paper']) {
      const res = await request(app).post(`/api/v1/quotes/${id}${path}`).set('Cookie', other).send({});
      expect(res.status, `${path} 가 열렸다`).toBe(403);
    }
  });

  it('🔴 계약 상태·서명본이 열리지 않는다', async () => {
    const id = await targetQuote();
    for (const path of ['/contract', '/contract/signed']) {
      const res = await request(app).get(`/api/v1/quotes/${id}${path}`).set('Cookie', other);
      expect(res.status, `${path} 가 열렸다`).toBe(403);
    }
  });

  it('🔴 관리자 권한이 있으면 막지 않는다 — 관제하는 자리다', async () => {
    /*
     * 「내 고객만 본다」는 **영업 화면에서만** 해당한다. 여기서까지 막으면
     * 관리자가 남의 건을 열어 볼 수 없어 관제가 불가능해진다.
     */
    const id = await targetQuote();
    const res = await request(app).get(`/api/v1/quotes/${id}`).set('Cookie', admin);
    expect(res.status, '관리자가 막혔다').not.toBe(403);
  });

  it('본인 담당 건은 그대로 열린다', async () => {
    const id = await targetQuote();
    const res = await request(app).get(`/api/v1/quotes/${id}`)
      .set('Cookie', authCookie(OWNER, 'SALES', 'ORG_SALES1'));
    expect(res.status, '본인 건이 막혔다').toBe(200);
  });

  it('🔴 남의 견적을 고객에게 메일로 보내지 못한다', async () => {
    // 밖으로 나가는 행위다 — 잘못 열리면 되돌릴 수 없다
    const id = await targetQuote();
    const send = await request(app).post(`/api/v1/quotes/${id}/email`).set('Cookie', other).send({ to: 'x@example.invalid' });
    expect(send.status, '남의 견적이 발송됐다').toBe(403);
    const log = await request(app).get(`/api/v1/quotes/${id}/email-log`).set('Cookie', other);
    expect(log.status).toBe(403);
  });

  it('🔴 남의 주문 상세·튜닝 서류가 열리지 않는다', async () => {
    const order = await prisma!.order.findFirst({
      where: { quote: { sales_user_id: OWNER } }, select: { id: true },
    });
    if (!order) return;   // 시험할 주문이 없으면 건너뛴다
    for (const url of [`/api/v1/orders/${order.id}`, `/api/v1/orders/${order.id}/tuning`,
                       `/api/v1/orders/${order.id}/docs/contract`]) {
      const res = await request(app).get(url).set('Cookie', other);
      expect(res.status, `${url} 가 열렸다`).toBe(403);
    }
  });

  it('없는 견적은 404 — 있는데 못 보는 것(403)과 구분한다', async () => {
    const res = await request(app).get('/api/v1/quotes/99999999').set('Cookie', other);
    expect(res.status).toBe(404);
  });
});
