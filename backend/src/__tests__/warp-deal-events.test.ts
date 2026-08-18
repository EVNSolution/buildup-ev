/**
 * WARP 딜 이벤트 push (#200) — fire-and-forget 계약 검증.
 *
 * 핵심: 이 push 는 어떤 경우에도 던지지(throw) 않아야 한다 — 견적 저장·계약
 * 전이의 부수 작업일 뿐이다. DB 필요한 부분은 DATABASE_URL 있을 때만 돈다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushWarpDealEvent } from '../services/warp-crm.js';
import { prisma } from '../lib/prisma.js';

const shouldSkipDb = !process.env['DATABASE_URL'];

beforeEach(() => {
  vi.stubEnv('WARP_API_BASE_URL', 'http://warp.test');
  vi.stubEnv('WARP_API_KEY', 'k'.repeat(64));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pushWarpDealEvent — 어떤 실패도 밖으로 던지지 않는다', () => {
  it('env 미설정이면 fetch 없이 조용히 끝난다', async () => {
    vi.stubEnv('WARP_API_BASE_URL', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(pushWarpDealEvent('quote_created', 1)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.skipIf(shouldSkipDb)('없는 견적이면 fetch 없이 끝난다', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(pushWarpDealEvent('quote_created', 999999999)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.skipIf(shouldSkipDb)('멱등키·요약 payload 로 WARP 에 POST 한다 (고객 연결 포함)', async () => {
    const cust = await prisma!.customer.create({
      data: { name: '__deal_event_test__', phone: '010-1111-2222', warp_customer_id: 'warp-x' },
      select: { id: true },
    });
    const quote = await prisma!.quote.create({
      data: {
        model_code: 'PV5_OPENBED', selections: {}, inputs: {},
        supply_price: 1000, final_price: 2000, status: 'draft', customer_id: cust.id,
      },
      select: { id: true },
    });
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await pushWarpDealEvent('contract_completed', quote.id);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe('http://warp.test/api/external/deal-events');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.event_key).toBe(`contract_completed:${quote.id}`);
      expect(body.quote.final_price).toBe(2000);
      expect(body.customer.warp_customer_id).toBe('warp-x');
      // 내부 정보(selections·inputs·영업 계정)는 싣지 않는다
      expect(body.quote.selections).toBeUndefined();
      expect(body.quote.sales_user_id).toBeUndefined();
    } finally {
      await prisma!.quote.delete({ where: { id: quote.id } });
      await prisma!.customer.delete({ where: { id: cust.id } });
    }
  });

  it.skipIf(shouldSkipDb)('WARP 다운·비200 에도 throw 하지 않는다', async () => {
    const cust = await prisma!.customer.create({ data: { name: '__deal_event_test2__' }, select: { id: true } });
    const quote = await prisma!.quote.create({
      data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, supply_price: 1, final_price: 1, status: 'draft', customer_id: cust.id },
      select: { id: true },
    });
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
      await expect(pushWarpDealEvent('quote_created', quote.id)).resolves.toBeUndefined();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
      await expect(pushWarpDealEvent('quote_created', quote.id)).resolves.toBeUndefined();
    } finally {
      await prisma!.quote.delete({ where: { id: quote.id } });
      await prisma!.customer.delete({ where: { id: cust.id } });
    }
  });
});
