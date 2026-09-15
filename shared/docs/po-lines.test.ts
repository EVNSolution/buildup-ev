import { describe, it, expect } from 'vitest';
import { contractLines, autoLines, lineQty, type MakerPriceRow } from './po-lines';

/**
 * **도어 변경 발주 수량**(2026-09-15 지시) — 도어 추가 없이 바꾸면 변경 금액 1번, 도어 추가와 함께 바꾸면 2번.
 * 추가한 운전석 도어도 같은 종류로 바꾸기 때문이다. 수량은 단가표에 적는 값이 아니다.
 */
const row = (p: Partial<MakerPriceRow>): MakerPriceRow => ({
  label: 'x', group_code: null, value_code: null, top_code: null, section: 'OPTION',
  work_by: 'MAKER', unit: 'EA', unit_price: null, sort_order: 0, memo: null, ...p,
});
const ROWS: MakerPriceRow[] = [
  row({ label: 'STEGO K1 저상형', group_code: 'BODYTYPE', value_code: 'BODY_REEFER', top_code: 'TOP_LOW', section: 'BASE', unit: 'SET', unit_price: 6_700_000 }),
  row({ label: '슬라이딩 도어 변경', group_code: 'DOORTYPE', value_code: 'DOOR_SLIDE', top_code: 'TOP_LOW', unit_price: 275_000, sort_order: 21 }),
  row({ label: '슬라이딩 도어 변경', group_code: 'DOORTYPE', value_code: 'DOOR_SLIDE', top_code: 'TOP_STD', unit_price: 295_000, sort_order: 22 }),
  row({ label: '냉동/냉장 미닫이 도어', group_code: 'DOORTYPE', value_code: 'DOOR_EVSLIDE', sort_order: 23 }),
  row({ label: '여닫이 도어', group_code: 'DOORTYPE', value_code: 'DOOR_SWING', work_by: 'NONE' }),
  row({ label: '도어 추가 없음', group_code: 'DOORADD', value_code: 'ADD_NONE', work_by: 'NONE' }),
  row({ label: '운전석 스윙도어', group_code: 'DOORADD', value_code: 'ADD_DRIVER', top_code: 'TOP_LOW', unit_price: 480_000, sort_order: 31 }),
  row({ label: '운전석 스윙도어', group_code: 'DOORADD', value_code: 'ADD_DRIVER', top_code: 'TOP_STD', unit_price: 520_000, sort_order: 32 }),
];
const sel = (door: string, add: string, top = 'TOP_LOW') => ({ BODYTYPE: 'BODY_REEFER', TOP: top, DOORTYPE: door, DOORADD: add });
const summary = (s: Record<string, string>) =>
  contractLines(s, ROWS).filter(l => l.section === 'OPTION').map(l => [l.label, l.qty, l.unit_price, l.amount]);

describe('도어 변경 · 도어 추가 발주 줄', () => {
  it('🔴 도어 추가 없이 변경 — 변경 금액 한 번', () => {
    expect(summary(sel('DOOR_SLIDE', 'ADD_NONE'))).toEqual([['슬라이딩 도어 변경', 1, 275_000, 275_000]]);
    expect(summary(sel('DOOR_SLIDE', 'ADD_NONE', 'TOP_STD'))).toEqual([['슬라이딩 도어 변경', 1, 295_000, 295_000]]);
  });
  it('🔴 도어 추가 + 변경 — 변경 금액 두 번 + 운전석 도어 추가 한 줄', () => {
    expect(summary(sel('DOOR_SLIDE', 'ADD_DRIVER'))).toEqual([
      ['슬라이딩 도어 변경', 2, 275_000, 550_000],
      ['운전석 스윙도어', 1, 480_000, 480_000],
    ]);
  });
  it('🔴 여닫이(기본) + 도어 추가 — 변경 줄 없이 추가 한 줄', () => {
    expect(summary(sel('DOOR_SWING', 'ADD_DRIVER', 'TOP_STD'))).toEqual([['운전석 스윙도어', 1, 520_000, 520_000]]);
    expect(summary(sel('DOOR_SWING', 'ADD_NONE'))).toEqual([]);
  });
  it('🔴 단가 없는 도어 변경(금액 빈 줄)도 같은 수량 규칙', () => {
    const picked = (add: string) => [{ group_code: 'DOORTYPE', value_code: 'DOOR_EVSLIDE', value_name: '냉동/냉장 미닫이', is_body: true }, { group_code: 'DOORADD', value_code: add, value_name: add, is_body: true }];
    expect(autoLines(picked('ADD_NONE'), ROWS, sel('DOOR_EVSLIDE', 'ADD_NONE')).map(l => [l.label, l.qty])).toEqual([['냉동/냉장 미닫이 도어', 1]]);
    expect(autoLines(picked('ADD_DRIVER'), ROWS, sel('DOOR_EVSLIDE', 'ADD_DRIVER')).map(l => [l.label, l.qty])).toEqual([['냉동/냉장 미닫이 도어', 2]]);
  });
  it('🔴 그 밖의 줄은 1 — 기본형·도어 추가', () => {
    expect(lineQty('BODYTYPE', sel('DOOR_SLIDE', 'ADD_DRIVER'))).toBe(1);
    expect(lineQty('DOORADD', sel('DOOR_SLIDE', 'ADD_DRIVER'))).toBe(1);
    expect(contractLines(sel('DOOR_SLIDE', 'ADD_DRIVER'), ROWS).find(l => l.section === 'BASE')?.qty).toBe(1);
  });
});
