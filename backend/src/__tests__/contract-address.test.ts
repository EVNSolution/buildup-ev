import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **계약서 주소에 지역(region)을 섞지 않는다.**
 *
 * `region` 은 **보조금 산정용 시·군·구 선택값**이지 주소가 아니다. 그런데 주소 앞에
 * 덧대던 시절이 있어 이렇게 찍혔다(실제 제보):
 *
 *     경기 군포시 경상북도 울릉군 울릉읍 …      ← 지역 + 주소가 겹침
 *
 * 주소 검색 결과에는 시·도가 이미 들어 있다. 계약서에 나가는 값이라 그냥 두면 안 된다.
 * 주소 = **주소 검색 결과 + 상세주소**, 그것뿐이다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const SRC = readFileSync(path.join(ROOT, 'backend/src/services/contract-docgen.ts'), 'utf8');

/**
 * `buyer_address` 를 **실제로 조립하는 줄**만 잘라 온다.
 *
 * ⚠️ 그냥 `indexOf('buyer_address:')` 를 쓰면 위쪽 **타입 선언**
 *    (`buyer_address: string; buyer_tel: string; …`)이 먼저 걸려 아무것도 검사하지 못한다.
 *    값을 만드는 줄은 배열로 시작한다.
 */
function buyerAddressExpr(): string {
  const m = SRC.match(/^\s*buyer_address:\s*\[.*$/m);
  expect(m, 'buyer_address 조립부를 찾지 못했다').not.toBeNull();
  return m![0];
}

describe('계약서 주소', () => {
  it('🔴 주소를 만들 때 region 을 쓰지 않는다', () => {
    const expr = buyerAddressExpr();
    expect(expr).not.toContain('region');
  });

  it('주소 검색 결과와 상세주소로만 만든다', () => {
    const expr = buyerAddressExpr();
    expect(expr).toContain('customer?.address');
    expect(expr).toContain('addressDetail');
  });

  it('상세주소는 고객 정보를 정본으로 쓰고, 옛 견적은 견적 입력에서 가져온다', () => {
    /*
     * 고객정보 수정이 고객 테이블에 저장한다 — 거기가 최신이다.
     * 예전 견적은 견적 입력에만 상세주소가 남아 있어, 그때는 그쪽을 쓴다.
     * 한쪽만 보면 상세주소가 통째로 빠진 계약서가 나간다(실제로 그랬다).
     */
    const i = SRC.indexOf('const addressDetail');
    expect(i).toBeGreaterThan(-1);
    const decl = SRC.slice(i, i + 260);
    expect(decl).toContain("customer?.address_detail");
    expect(decl).toContain("inp['address_detail']");
  });

  it('빈 값이 섞여도 공백이 남지 않는다', () => {
    // 주소만 있고 상세가 없으면 「주소 」로 끝나면 안 된다
    const expr = buyerAddressExpr();
    expect(expr).toContain('filter(Boolean)');
    expect(expr).toContain('.trim()');
  });
});
