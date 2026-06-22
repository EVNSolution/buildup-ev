import { describe, it, expect } from 'vitest';
import { calcPrice } from './core.js';
import { REGRESSION_PARAMS, REGRESSION_REAL_PRICE } from './fixtures.js';

describe('calcPrice — 견적 계산 코어', () => {
  it('회귀: TRIM_PLUS+저상+슬라이딩+온도O+그물망+소상공인+경기남양주 → ₩46,471,818 (±1)', () => {
    const r = calcPrice(REGRESSION_PARAMS);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(Math.abs(r.real_price - REGRESSION_REAL_PRICE)).toBeLessThanOrEqual(1);
  });

  it('세부 항목 검증', () => {
    const r = calcPrice(REGRESSION_PARAMS);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.supply_price).toBe(63_336_364);
    expect(r.vat).toBe(6_333_636);
    expect(r.vehicle_price).toBe(69_670_000);
    expect(r.subsidy_national).toBe(11_500_000);
    expect(r.subsidy_local).toBe(3_450_000);
    expect(r.subsidy_sosang).toBe(3_450_000);
    expect(r.subsidy_total).toBe(18_400_000);
    expect(r.vat_refunded_price).toBe(44_936_364);
    expect(r.reg_cost).toBe(1_306_454);
    expect(r.etc_cost).toBe(229_000);
    expect(r.real_price).toBe(46_471_818);
  });

  it('BODY_DRY → unsupported (TBD 메시지 포함)', () => {
    const r = calcPrice({ ...REGRESSION_PARAMS, bodytype_code: 'BODY_DRY' });
    expect(r.status).toBe('unsupported');
    if (r.status === 'unsupported') {
      expect(r.reason).toMatch(/TBD/);
    }
  });

  it('법인사업자 → 지방보조금·소상공인 보조금 0', () => {
    const r = calcPrice({
      ...REGRESSION_PARAMS,
      customer: { biz_type: 'corporation', is_sosang: false },
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.subsidy_local).toBe(0);
    expect(r.subsidy_sosang).toBe(0);
  });

  it('간이과세자 → 부가세 0, 차량가 = 공급가액', () => {
    const r = calcPrice({
      ...REGRESSION_PARAMS,
      customer: { biz_type: 'simplified', is_sosang: false },
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.vat).toBe(0);
    expect(r.vehicle_price).toBe(r.supply_price);
  });

  it('도어추가(ADD_DRIVER) → 선택 도어 단품 1회 추가', () => {
    const r = calcPrice({
      ...REGRESSION_PARAMS,
      door: { ...REGRESSION_PARAMS.door, has_extra: true },
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    // door_price = (760000-480000) + 760000 = 1040000 → supply_price += 760000
    expect(r.supply_price).toBe(63_336_364 + 760_000);
  });
});
