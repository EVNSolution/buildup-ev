import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * **웹훅이 잠긴 동안 계약 상태를 따라잡는 길** — 지켜야 할 것들.
 *
 * 모두싸인 웹훅이 계정에서 잠겨 있어(`/webhooks` → 403) 「서명 완료」가 오지 않는다.
 * 그래서 견적 목록을 불러올 때 함께 따라잡는다. 사람이 새로고침을 누를 때마다 도는
 * 코드라, **호출이 새는 방향**과 **목록이 느려지는 방향** 둘 다 막아야 한다.
 */
vi.mock('../services/contract.js', () => ({
  refreshContractStatus: vi.fn(),
}));

import { refreshContractStatus } from '../services/contract.js';
import { syncOpenContracts, _resetCooldown } from '../services/contract-sync.js';

const refresh = vi.mocked(refreshContractStatus);

/** findMany 가 돌려줄 계약들을 세팅한 가짜 prisma. */
function fakePrisma(rows: { id: number; quote_id: number; status: string }[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { prisma: { purchaseContract: { findMany } } as never, findMany };
}

beforeEach(() => { _resetCooldown(); refresh.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('계약 상태 따라잡기', () => {
  it('끝나지 않은 계약만, 서면계약은 빼고 고른다', async () => {
    const { prisma, findMany } = fakePrisma([]);
    await syncOpenContracts(prisma);

    const where = findMany.mock.calls[0]![0]!.where;
    // 서면계약은 모두싸인에 문서가 없다 — 물어볼 곳이 없다
    expect(where.signing_method).toEqual({ not: 'PAPER' });
    // 이미 끝난 건을 다시 물으면 상태를 되돌릴 위험만 생긴다
    expect(where.status.notIn).toEqual(expect.arrayContaining(['COMPLETED', 'REJECTED', 'CANCELED']));
    // 문서 id 가 없으면 조회할 대상 자체가 없다
    expect(where.modusign_document_id).toEqual({ not: null });
  });

  it('오래된 건은 더 묻지 않는다 — 끝내 서명 안 한 건을 몇 달씩 부르지 않게', async () => {
    const { prisma, findMany } = fakePrisma([]);
    await syncOpenContracts(prisma);
    const cutoff = findMany.mock.calls[0]![0]!.where.sent_at.gte as Date;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(30);
    expect(days).toBeLessThan(120);
  });

  it('한 번에 부르는 건수에 상한이 있다 — 계약이 쌓여도 새로고침이 무거워지지 않게', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, quote_id: 100 + i, status: 'SENT' }));
    const { prisma } = fakePrisma(rows);
    refresh.mockResolvedValue({ status: 'SENT' } as never);

    await syncOpenContracts(prisma);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('같은 계약을 연달아 다시 묻지 않는다 — 여러 명이 동시에 눌러도 한 번', async () => {
    const rows = [{ id: 1, quote_id: 501, status: 'SENT' }];
    const { prisma } = fakePrisma(rows);
    refresh.mockResolvedValue({ status: 'SENT' } as never);

    await syncOpenContracts(prisma);   // 영업이 새로고침
    await syncOpenContracts(prisma);   // 관리자가 곧바로 새로고침
    await syncOpenContracts(prisma);   // 또 한 명

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('한 건이 실패해도 나머지는 계속하고, 실패한 건은 쿨다운을 태우지 않는다', async () => {
    const rows = [
      { id: 1, quote_id: 601, status: 'SENT' },
      { id: 2, quote_id: 602, status: 'SENT' },
    ];
    const { prisma } = fakePrisma(rows);
    refresh.mockImplementation(async (qid: number) => {
      if (qid === 601) throw new Error('모두싸인 502');
      return { status: 'SENT' } as never;
    });

    await syncOpenContracts(prisma);
    // 실패했어도 602 는 처리됐다
    expect(refresh.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining([601, 602]));

    // 실패한 601 은 다음 새로고침에 **다시** 시도된다(성공한 602 는 쿨다운에 걸린다)
    refresh.mockReset();
    refresh.mockResolvedValue({ status: 'SENT' } as never);
    await syncOpenContracts(prisma);
    expect(refresh.mock.calls.map(c => c[0])).toEqual([601]);
  });

  it('모두싸인이 느려도 목록을 오래 잡아 두지 않는다', async () => {
    const rows = [{ id: 1, quote_id: 701, status: 'SENT' }];
    const { prisma } = fakePrisma(rows);
    // 영원히 안 끝나는 조회
    refresh.mockImplementation(() => new Promise(() => {}) as never);

    const t0 = Date.now();
    await syncOpenContracts(prisma);
    const elapsed = Date.now() - t0;
    // 3초 예산 + 여유. 이게 깨지면 견적 목록이 모두싸인 장애에 끌려간다.
    expect(elapsed).toBeLessThan(5_000);
  });

  it('정말 달라진 건수만 센다', async () => {
    const rows = [
      { id: 1, quote_id: 801, status: 'SENT' },
      { id: 2, quote_id: 802, status: 'SENT' },
    ];
    const { prisma } = fakePrisma(rows);
    refresh.mockImplementation(async (qid: number) =>
      ({ status: qid === 801 ? 'COMPLETED' : 'SENT' }) as never);

    // 801 만 바뀌었다 — 「불렀다」가 아니라 「달라졌다」를 세야 로그가 쓸모 있다
    expect(await syncOpenContracts(prisma)).toBe(1);
  });
});

describe('견적 목록이 계약 동기화에 끌려가지 않는다', () => {
  it('동기화 실패를 삼키고 목록을 그대로 내보낸다', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(path.resolve(__dirname, '../routes/quotes.ts'), 'utf8');
    const i = src.indexOf('syncOpenContracts(prisma)');
    expect(i).toBeGreaterThan(-1);
    // 부르는 자리가 try/catch 안에 있어야 한다 — 모두싸인이 죽어도 견적 화면은 떠야 한다
    const around = src.slice(Math.max(0, i - 400), i + 400);
    expect(around).toContain('catch');
    expect(around).toMatch(/목록은 그대로 내보낸다/);
  });
});
