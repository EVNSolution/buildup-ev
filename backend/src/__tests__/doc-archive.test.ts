import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * **고객별 서류 보관함** — 쌓이는 규칙을 못박는다.
 *
 * 여기서 지키는 것은 셋이다:
 *   ① 생성 순서대로 번호가 붙는다 — `ls` 한 줄로 시간순이 보여야 한다
 *   ② 같은 내용은 다시 쌓지 않는다 — 견적서는 열 때마다 렌더되므로, 이게 없으면
 *      하루에 똑같은 파일이 수십 장 생긴다(만들 때 실제로 그랬다)
 *   ③ 고객 이름이 바뀌어도 쌓이던 폴더를 계속 쓴다 — 갈리면 서류가 두 곳에 흩어진다
 */
const ROOT = await mkdtemp(path.join(tmpdir(), 'doc-archive-test-'));
process.env['DOC_STORAGE_DIR'] = ROOT;

const { archiveCustomerDoc, archiveRoot } = await import('../services/doc-archive.js');

/** 진짜 PDF 처럼 생긴 최소 바이트 — 만든 시각이 박히는 자리를 포함한다. */
function fakePdf(body: string, stamp = '20260819061144'): Buffer {
  return Buffer.from(
    `%PDF-1.4\n<< /Producer (test)\n/CreationDate (D:${stamp}+00'00')\n/ModDate (D:${stamp}+00'00') >>\n${body}\n%%EOF`,
    'latin1',
  );
}

async function names(dirName: string): Promise<string[]> {
  return (await readdir(path.join(archiveRoot(), dirName))).sort();
}

beforeEach(async () => {
  await rm(archiveRoot(), { recursive: true, force: true });
});
afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe('고객별 서류 보관함', () => {
  it('생성 순서대로 번호가 붙는다', async () => {
    await archiveCustomerDoc({ customerId: 7, customerName: '홍길동', quoteNo: '26-0001', kind: '견적서', pdf: fakePdf('A') });
    await archiveCustomerDoc({ customerId: 7, customerName: '홍길동', quoteNo: '26-0001', kind: '계약서', pdf: fakePdf('B') });
    await archiveCustomerDoc({ customerId: 7, customerName: '홍길동', quoteNo: '26-0001', kind: '계약서_서명본', pdf: fakePdf('C') });

    const files = await names('7_홍길동');
    expect(files.map(f => f.slice(0, 4))).toEqual(['0001', '0002', '0003']);
    expect(files[0]).toMatch(/_견적서_26-0001\.pdf$/);
    expect(files[2]).toMatch(/_계약서_서명본_26-0001\.pdf$/);
  });

  it('같은 내용이면 다시 쌓지 않는다', async () => {
    const pdf = fakePdf('SAME');
    expect(await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '견적서', pdf })).not.toBeNull();
    expect(await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '견적서', pdf })).toBeNull();
    expect(await names('7_홍')).toHaveLength(1);
  });

  it('만든 시각만 다른 것은 같은 내용으로 본다', async () => {
    // PDF 는 렌더할 때마다 /CreationDate 가 달라진다. 그걸 다름으로 치면 열 때마다 쌓인다
    await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '견적서', pdf: fakePdf('SAME', '20260819061144') });
    await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '견적서', pdf: fakePdf('SAME', '20260819235959') });
    expect(await names('7_홍')).toHaveLength(1);
  });

  it('내용이 달라지면 새 번호를 받는다', async () => {
    await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '견적서', pdf: fakePdf('V1') });
    await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '견적서', pdf: fakePdf('V2') });
    expect(await names('7_홍')).toHaveLength(2);
  });

  it('종류가 다르면 서로의 중복 검사에 걸리지 않는다', async () => {
    const pdf = fakePdf('SAME');
    await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '견적서', pdf });
    await archiveCustomerDoc({ customerId: 7, customerName: '홍', quoteNo: '26-0001', kind: '계약서', pdf });
    expect(await names('7_홍')).toHaveLength(2);
  });

  it('고객 이름이 바뀌어도 쌓이던 폴더를 계속 쓴다', async () => {
    await archiveCustomerDoc({ customerId: 7, customerName: '홍길동', quoteNo: '26-0001', kind: '견적서', pdf: fakePdf('A') });
    await archiveCustomerDoc({ customerId: 7, customerName: '홍길순', quoteNo: '26-0001', kind: '계약서', pdf: fakePdf('B') });
    expect(await readdir(archiveRoot())).toEqual(['7_홍길동']);
    expect(await names('7_홍길동')).toHaveLength(2);
  });

  it('고객이 없으면 아무것도 쌓지 않는다', async () => {
    // 공개 접수 직후처럼 아직 고객 행이 없을 수 있다 — 쌓을 자리가 없다
    expect(await archiveCustomerDoc({ customerId: null, customerName: null, kind: '견적서', pdf: fakePdf('A') })).toBeNull();
  });

  it('이름에 경로 구분자가 들어와도 폴더 밖으로 나가지 않는다', async () => {
    await archiveCustomerDoc({ customerId: 7, customerName: '../../etc', quoteNo: '26-0001', kind: '견적서', pdf: fakePdf('A') });
    const dirs = await readdir(archiveRoot());
    expect(dirs).toEqual(['7_....etc']);
  });
});
