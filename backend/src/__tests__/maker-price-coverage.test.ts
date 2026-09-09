import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **특장사 단가표는 옵션과 빠짐없이 맞물린다.**
 *
 * 옵션마다 행이 하나씩 미리 있고, 관리자는 값만 고친다. 행을 만들거나 지우지 않는다 —
 * 아무 코드로나 행을 만들 수 있으면 어느 선택에도 걸리지 않는 유령 줄이 쌓이고,
 * 「이 옵션은 누가 하기로 했더라」를 표에서 답할 수 없게 된다.
 *
 * 옵션을 새로 더하면 이 검사가 먼저 빨개진다 — 발주서에서 조용히 빠지기 전에.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** 아주 작은 CSV 파서 — 시드 파일에는 따옴표가 없다(있으면 여기서 티가 난다) */
function rows(rel: string): Record<string, string>[] {
  const lines = read(rel).trim().split('\n');
  const head = lines[0]!.split(',').map(h => h.trim());
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    expect(cells.length, `열 수가 머리글과 다르다: ${rel} — ${l}`).toBe(head.length);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const VALUES = rows('db/seed/option_value.csv');
const PRICES = rows('db/seed/maker_price.csv');

/** 화면에 뜨는 옵션값 — 내부 가격키(_PRICEKEY)는 사람이 고르는 것이 아니다 */
const pickable = VALUES.filter(v => v['active'] === 'Y' && v['group_code'] !== '_PRICEKEY');

describe('특장사 단가표 — 옵션과의 맞물림', () => {
  it('시드를 실제로 읽었다', () => {
    // 파싱이 깨지면 「빠진 것이 없다」가 거짓으로 초록이 된다
    expect(pickable.length).toBeGreaterThan(20);
    expect(PRICES.length).toBeGreaterThan(20);
  });

  it('🔴 고를 수 있는 옵션은 **하나도 빠짐없이** 단가표에 있다', () => {
    /*
     * 행이 없는 옵션은 발주서에서 **조용히 빠진다.** 특장사가 그 일을 하기로 했는데
     * 발주서에 안 실리면 대금을 못 받고, 우리는 안 시킨 줄 안다.
     */
    const covered = new Set(PRICES.map(p => p['value_code']));
    const missing = pickable.map(v => v['code']!).filter(c => !covered.has(c));
    expect(missing, `단가표에 없는 옵션:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('🔴 없는 옵션을 가리키는 행이 없다', () => {
    // 옵션이 사라졌는데 행이 남으면 어느 선택에도 안 걸리는 유령 줄이 된다
    const known = new Set(VALUES.map(v => v['code']));
    const ghosts = PRICES.map(p => p['value_code']!).filter(c => !known.has(c));
    expect(ghosts, `없는 옵션을 가리키는 행:\n  ${ghosts.join('\n  ')}`).toEqual([]);
  });

  it('🔴 분류는 셋 중 하나다', () => {
    /*
     * MAKER = 특장사가 한다(발주서에 실린다) · EVN = EV& 가 직접 한다 · NONE = 할 일이 없다.
     * EVN 과 NONE 은 발주서에 안 실리는 결과가 같지만 **뜻이 다르다** —
     * 나중에 「이거 누가 하기로 했더라」를 여기서 답한다.
     */
    const bad = PRICES.filter(p => !['MAKER', 'EVN', 'NONE'].includes(p['work_by'] ?? ''));
    expect(bad.map(p => `${p['value_code']}=${p['work_by']}`), '분류가 셋 밖이다').toEqual([]);
  });

  it('🔴 단가는 **특장사 몫에만** 붙는다', () => {
    // 우리가 하는 일(EVN)이나 아무 일도 아닌 값(NONE)에 지급 단가가 붙어 있으면 잘못 나간다
    const wrong = PRICES.filter(p => p['work_by'] !== 'MAKER' && p['unit_price'] !== '');
    expect(wrong.map(p => `${p['value_code']}=${p['unit_price']}`), '특장사 몫이 아닌데 단가가 있다').toEqual([]);
  });

  it('🔴 단가는 0 원으로 채워 두지 않는다', () => {
    /*
     * 0 원은 「무상으로 해 주기로 했다」는 뜻이 되어 특장사에게 그대로 나간다.
     * 계약에 값이 없으면 **비워 둔다** — 그러면 발주서에 금액 칸이 저절로 생긴다.
     */
    const zero = PRICES.filter(p => p['unit_price'] === '0');
    expect(zero.map(p => p['value_code']), '0 원으로 채운 행이 있다').toEqual([]);
  });

  it('🔴 같은 옵션·같은 탑에 단가는 하나뿐이다', () => {
    // 여럿이면 어느 값이 맞는지 알 수 없다(DB 의 유일 제약과 같은 규칙)
    const seen = new Map<string, number>();
    for (const p of PRICES) {
      const k = `${p['maker_org_id']}|${p['group_code']}|${p['value_code']}|${p['top_code']}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dup, `같은 자리에 행이 여럿이다:\n  ${dup.join('\n  ')}`).toEqual([]);
  });

  it('🔴 계약서 단가가 계약서 그대로다', () => {
    /*
     * 브레인특장 기본거래계약서(2026-07-29) [별첨1].
     * 손으로 옮긴 값이라 **한 번 더 견준다** — 여기가 틀리면 우리가 잘못된 금액을 지급한다.
     */
    const find = (v: string, top: string) =>
      PRICES.find(p => p['value_code'] === v && p['top_code'] === top);
    expect(find('BODY_REEFER', 'TOP_LOW')?.['unit_price'], '기본형 저상').toBe('6700000');
    expect(find('BODY_REEFER', 'TOP_STD')?.['unit_price'], '기본형 표준').toBe('6900000');
    expect(find('ADD_DRIVER', 'TOP_LOW')?.['unit_price'], '운전석 스윙도어 저상').toBe('480000');
    expect(find('ADD_DRIVER', 'TOP_STD')?.['unit_price'], '운전석 스윙도어 표준').toBe('520000');
    expect(find('DOOR_SLIDE', 'TOP_LOW')?.['unit_price'], '슬라이딩 저상').toBe('275000');
    expect(find('DOOR_SLIDE', 'TOP_STD')?.['unit_price'], '슬라이딩 표준').toBe('295000');
    expect(find('PART_NET', 'TOP_LOW')?.['unit_price'], '격벽 저상').toBe('65000');
    expect(find('PART_NET', 'TOP_STD')?.['unit_price'], '격벽 표준').toBe('65000');
    // 슬라이딩은 좌·우 2개 — 계약서 발주서 예시(별첨3)가 2 EA 다
    expect(find('DOOR_SLIDE', 'TOP_LOW')?.['qty'], '슬라이딩 수량').toBe('2');
  });

  it('🔴 행은 옵션에 **묶여 있다** — 아무 코드로나 만들 수 없다', () => {
    const schema = read('backend/prisma/schema.prisma');
    expect(schema, '옵션값과의 외래키가 없다')
      .toMatch(/option\s+OptionValue\?\s+@relation\("MakerPriceValue", fields: \[value_code\], references: \[code\]\)/);
    // 고치는 API 도 연결을 건드리지 않는다
    const routes = read('backend/src/routes/quotes.ts');
    const patch = routes.slice(routes.indexOf("quotesRouter.patch('/maker-prices/:id'"));
    for (const f of ['group_code', 'value_code', 'top_code']) {
      expect(patch.slice(0, 2000), `${f} 를 고칠 수 있게 열려 있다`).not.toMatch(new RegExp(`${f}:`));
    }
    // 만들거나 지우는 길도 없다
    expect(routes, '단가표 행을 만드는 길이 생겼다').not.toMatch(/makerPrice\.create/);
    expect(routes, '단가표 행을 지우는 길이 생겼다').not.toMatch(/makerPrice\.delete/);
  });
});
