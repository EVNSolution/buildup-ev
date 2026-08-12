import { describe, it, expect } from 'vitest';
import { nextQuoteNo } from '../services/quote-no.js';

/**
 * 견적번호는 **한 번 나가면 끝**이다 — 견적을 지워도 그 번호가 다시 나오면 안 된다.
 * 견적서·계약서가 번호를 달고 고객에게 나가므로, 같은 번호가 두 건에 붙으면
 * 나중에 어느 쪽이 진짜인지 가릴 수 없다(되돌릴 수 없는 사고).
 *
 * 실제 채번은 SQL 두 문장(기존 최대번호 조회 + 채번대장 UPSERT … RETURNING)이라,
 * 여기선 그 두 문장의 의미를 그대로 흉내 낸 가짜 클라이언트로 규칙을 검증한다.
 */
function fakeClient(quoteNos: string[] = []) {
  const counter = new Map<number, number>();
  const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $queryRawUnsafe: async (sql: string, ...params: any[]): Promise<any> => {
      if (sql.includes('MAX(SUBSTRING')) {
        const prefix = params[0] as string;
        const seqs = quoteNos
          .filter((n) => /^[0-9]{2}-[0-9]{4}$/.test(n) && n.slice(0, 2) === prefix)
          .map((n) => Number(n.slice(3)));
        return [{ max_seq: seqs.length ? Math.max(...seqs) : null }];
      }
      const [year, start] = params as [number, number];
      const cur = counter.get(year);
      const next = cur === undefined ? start + 1 : Math.max(cur, start) + 1;
      counter.set(year, next);
      return [{ last_seq: next }];
    },
  };
  return { client: client as never, counter, quoteNos };
}

describe('견적번호 채번 (nextQuoteNo)', () => {
  it('YY-NNNN 형식으로 1번부터 매긴다', async () => {
    const { client } = fakeClient();
    expect(await nextQuoteNo(client, 2026)).toBe('26-0001');
    expect(await nextQuoteNo(client, 2026)).toBe('26-0002');
  });

  it('견적을 전부 지워도 다음 번호는 이어서 나간다 — 지운 번호는 재사용하지 않는다', async () => {
    const f = fakeClient();
    expect(await nextQuoteNo(f.client, 2026)).toBe('26-0001');
    expect(await nextQuoteNo(f.client, 2026)).toBe('26-0002');
    expect(await nextQuoteNo(f.client, 2026)).toBe('26-0003');

    f.quoteNos.length = 0;   // 화면에서 견적 3건을 모두 삭제한 상황

    expect(await nextQuoteNo(f.client, 2026)).toBe('26-0004');
  });

  it('채번대장이 비어 있으면 이미 쓰인 최대번호에서 이어 받는다(대장 도입 이전 견적)', async () => {
    const { client } = fakeClient(['26-0001', '26-0007', '26-0003']);
    expect(await nextQuoteNo(client, 2026)).toBe('26-0008');
  });

  it('대장보다 큰 번호가 견적에 있으면 그 뒤부터 — 어느 쪽도 덮어쓰지 않는다', async () => {
    const f = fakeClient();
    expect(await nextQuoteNo(f.client, 2026)).toBe('26-0001');
    f.quoteNos.push('26-0050');           // 손으로 넣은 번호가 섞인 경우
    expect(await nextQuoteNo(f.client, 2026)).toBe('26-0051');
  });

  it('연도가 바뀌면 다시 1번부터 — 대장은 연도별로 따로 센다', async () => {
    const { client } = fakeClient();
    expect(await nextQuoteNo(client, 2026)).toBe('26-0001');
    expect(await nextQuoteNo(client, 2027)).toBe('27-0001');
    expect(await nextQuoteNo(client, 2026)).toBe('26-0002');
  });

  it('동시에 발급해도 같은 번호가 두 번 나오지 않는다', async () => {
    const { client } = fakeClient();
    const nos = await Promise.all(Array.from({ length: 20 }, () => nextQuoteNo(client, 2026)));
    expect(new Set(nos).size).toBe(20);
  });
});
