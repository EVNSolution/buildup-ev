import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { groupCustomers, resolveDocId, docId, type FolderCustomer } from '../services/customer-folders.js';

/**
 * **같은 사람인가** — 서류함이 폴더를 나누는 기준.
 *
 * 고객 마스터(`customer-master.ts`)가 이미 이 판정을 하고 있고, 서류함은 같은 규칙을
 * 행 묶기로 옮겨 쓴다. 두 곳이 갈리면 마스터가 한 사람으로 본 것을 서류함은 둘로 보여 주고,
 * 「분명 보냈는데 서류함에 없다」가 된다.
 *
 *   ① 성명 + 생년월일(사업자번호)
 *   ② 성명 + 휴대폰 — 단 생년월일이 서로 어긋나면 다른 사람
 */
let seq = 0;
function c(p: Partial<FolderCustomer> & { name: string }): FolderCustomer {
  return {
    id: p.id ?? ++seq,
    name: p.name,
    reg_no: p.reg_no ?? null,
    phone: p.phone ?? null,
    updated_at: p.updated_at ?? new Date('2026-08-01T00:00:00Z'),
  };
}
const keysOf = (rows: FolderCustomer[]) =>
  groupCustomers(rows).map(g => g.ids).sort((a, b) => a[0]! - b[0]!);

describe('고객 묶기', () => {
  it('성명과 생년월일이 같으면 한 사람이다', () => {
    expect(keysOf([
      c({ id: 1, name: '홍길동', reg_no: '900101' }),
      c({ id: 2, name: '홍길동', reg_no: '900101' }),
    ])).toEqual([[1, 2]]);
  });

  it('성명이 같아도 생년월일이 다르면 다른 사람이다', () => {
    expect(keysOf([
      c({ id: 1, name: '홍길동', reg_no: '900101' }),
      c({ id: 2, name: '홍길동', reg_no: '910202' }),
    ])).toEqual([[1], [2]]);
  });

  it('생년월일이 없으면 휴대폰으로 묶는다', () => {
    // 견적 단계에서는 생년월일을 안 받는다 — 이것 없이는 계약 전 건이 전부 흩어진다
    expect(keysOf([
      c({ id: 1, name: '홍길동', phone: '010-1111-2222' }),
      c({ id: 2, name: '홍길동', phone: '01011112222' }),
    ])).toEqual([[1, 2]]);
  });

  it('계약하며 생년월일을 채운 행과 그 전 행이 한 폴더가 된다', () => {
    // 견적(생년월일 없음) → 계약(생년월일 채움). 갈리면 「보낸 견적서가 안 보인다」가 된다
    expect(keysOf([
      c({ id: 1, name: '홍길동', phone: '010-1111-2222' }),
      c({ id: 2, name: '홍길동', phone: '010-1111-2222', reg_no: '900101' }),
    ])).toEqual([[1, 2]]);
  });

  it('같은 번호를 쓰지만 생년월일이 다르면 나눈다 — 가족이 한 번호를 쓸 때', () => {
    expect(keysOf([
      c({ id: 1, name: '홍길동', phone: '010-1111-2222', reg_no: '900101' }),
      c({ id: 2, name: '홍길동', phone: '010-1111-2222', reg_no: '650505' }),
    ])).toEqual([[1], [2]]);
  });

  it('이름이 다르면 번호가 같아도 다른 사람이다', () => {
    expect(keysOf([
      c({ id: 1, name: '홍길동', phone: '010-1111-2222' }),
      c({ id: 2, name: '김철수', phone: '010-1111-2222' }),
    ])).toEqual([[1], [2]]);
  });

  it('이름의 띄어쓰기는 무시한다', () => {
    expect(keysOf([
      c({ id: 1, name: '홍 길동', phone: '010-1111-2222' }),
      c({ id: 2, name: '홍길동', phone: '010-1111-2222' }),
    ])).toEqual([[1, 2]]);
  });

  it('알아볼 값이 아무것도 없으면 묶지 않는다', () => {
    // 이름만 같다고 묶으면 남의 서류가 섞인다 — 「홍길동」은 흔하다
    expect(keysOf([
      c({ id: 1, name: '홍길동' }),
      c({ id: 2, name: '홍길동' }),
    ])).toEqual([[1], [2]]);
  });

  it('세 행이 사슬로 이어지면 한 폴더가 된다', () => {
    // 1–2 는 휴대폰으로, 2–3 은 생년월일로 이어진다
    expect(keysOf([
      c({ id: 1, name: '홍길동', phone: '010-1111-2222' }),
      c({ id: 2, name: '홍길동', phone: '010-1111-2222', reg_no: '900101' }),
      c({ id: 3, name: '홍길동', reg_no: '900101' }),
    ])).toEqual([[1, 2, 3]]);
  });

  it('열쇠는 그룹에서 가장 작은 고객번호다 — 행이 늘어도 주소가 변하지 않는다', () => {
    const g = groupCustomers([
      c({ id: 9, name: '홍길동', reg_no: '900101' }),
      c({ id: 4, name: '홍길동', reg_no: '900101' }),
    ]);
    expect(g[0]!.key).toBe(4);
  });

  it('대표 연락처는 가장 최근에 손댄 행에서 온다', () => {
    // 번호를 바꿨으면 새 번호가 맞다 — 옛 행의 값을 보여 주면 전화가 안 걸린다
    const g = groupCustomers([
      c({ id: 1, name: '홍길동', reg_no: '900101', phone: '010-0000-0000', updated_at: new Date('2026-01-01') }),
      c({ id: 2, name: '홍길동', reg_no: '900101', phone: '010-9999-9999', updated_at: new Date('2026-08-01') }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.phone).toBe('010-9999-9999');
  });

  it('이름이 다르면 생년월일이 같아도 나눈다 — 고객 마스터와 같은 기준', () => {
    /*
     * 성명은 판정의 일부다(customerMatches 도 성명을 함께 본다). 이름을 고치면 폴더가
     * 갈리지만, 그건 마스터가 이미 다른 사람으로 보고 있다는 뜻이라 여기만 다르게 볼 수 없다.
     */
    expect(keysOf([
      c({ id: 1, name: '홍길동', reg_no: '900101' }),
      c({ id: 2, name: '홍길순', reg_no: '900101' }),
    ])).toEqual([[1], [2]]);
  });
});

describe('파일 열쇠', () => {
  it('저장소 밖을 가리키면 풀리지 않는다', () => {
    // 열쇠는 화면에서 오는 값이다 — 막지 않으면 임의 파일 읽기가 된다
    const escape = Buffer.from('../../../etc/passwd.pdf', 'utf-8').toString('base64url');
    expect(resolveDocId(escape)).toBeNull();
  });

  it('PDF 가 아니면 풀리지 않는다', () => {
    const notPdf = Buffer.from('customers/1_홍/secret.env', 'utf-8').toString('base64url');
    expect(resolveDocId(notPdf)).toBeNull();
  });

  it('망가진 열쇠에도 죽지 않는다', () => {
    expect(resolveDocId('!!!not-base64!!!')).toBeNull();
    expect(resolveDocId('')).toBeNull();
  });

  it('만든 열쇠는 도로 풀린다', () => {
    process.env['DOC_STORAGE_DIR'] = '/tmp/doc-store-test';
    const abs = '/tmp/doc-store-test/customers/7_홍길동/0001_2026-08-19_견적서.pdf';
    expect(resolveDocId(docId(abs))).toBe(abs);
  });
});

describe('범위는 견적 목록과 같아야 한다', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../routes/customer-folders.ts'), 'utf8');

  it('견적을 읽는 곳은 모두 quoteScope 를 거친다', () => {
    /*
     * 서류함이 견적 목록보다 넓게 보면 「견적·주문에는 없는데 서류함에는 있다」가 된다.
     * 실제로 그랬다 — 고객 쪽에서 `quotes: { some: { sales_user_id } }` 로 골랐는데
     * 그 조건에 견적의 숨김 여부가 빠져 있어, 숨긴 견적의 고객이 서류함에만 남았다.
     */
    // 호출 지점마다 그 뒤 한 덩어리 안에 quoteScope 가 있는지 본다
    const calls = [...SRC.matchAll(/\.quote\.(?:findMany|aggregate)\(/g)];
    expect(calls.length, '견적을 읽는 곳이 하나도 안 잡혔다 — 검사식을 고쳐야 한다').toBeGreaterThan(0);
    for (const m of calls) {
      const chunk = SRC.slice(m.index!, m.index! + 260);
      expect(chunk, `quoteScope 를 안 거친다:\n${chunk}`).toMatch(/quoteScope\(req\)/);
    }
  });

  it('고객을 견적 없이 훑지 않는다 — 볼 수 있는 견적에서 출발한다', () => {
    // customer 를 먼저 훑으면 조건을 하나 빠뜨렸을 때 남의 고객이 조용히 섞인다
    expect(SRC).not.toMatch(/quotes:\s*\{\s*some:/);
  });
});
