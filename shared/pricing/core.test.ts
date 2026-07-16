import { describe, it, expect } from 'vitest';
import { calcPrice } from './core.js';
import { REGRESSION_PARAMS, REGRESSION_REAL_PRICE } from './fixtures.js';

describe('calcPrice — 견적 계산 코어 (견적서_Ver1.21)', () => {
  it('회귀(범석환): 베이직+냉동저상+울릉군+소상공인+택배 → ₩32,013,860', () => {
    const r = calcPrice(REGRESSION_PARAMS);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.real_price).toBe(REGRESSION_REAL_PRICE);
  });

  it('세부 항목 검증 (시트 D24~H34)', () => {
    const r = calcPrice(REGRESSION_PARAMS);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.supply_price).toBe(59_000_000);        // D24
    expect(r.vat).toBe(5_900_000);                  // D25
    expect(r.vehicle_price).toBe(64_900_000);       // D26
    expect(r.subsidy_national).toBe(11_500_000);    // D27
    expect(r.subsidy_local).toBe(12_040_000);       // D28
    expect(r.subsidy_sosang).toBe(3_450_000);       // D29
    expect(r.subsidy_diesel).toBe(0);               // D30
    expect(r.subsidy_takbae).toBe(1_150_000);       // D31
    expect(r.subsidy_total).toBe(28_140_000);       // D32
    expect(r.applied_price).toBe(36_760_000);       // D33 ①
    expect(r.vat_refunded_price).toBe(30_860_000);  // D34 ②
    expect(r.reg_acq_tax).toBe(1_930_860);          // H13
    expect(r.reg_acq_tax_relief).toBe(-1_400_000);  // H14
    expect(r.reg_special_acq_tax).toBe(334_000);    // H16
    expect(r.reg_cost).toBe(924_860);               // ③
    expect(r.etc_cost).toBe(229_000);               // ④
    expect(r.real_price).toBe(32_013_860);          // H34
  });

  it('간이과세자 → 부가세 0, 차량가 = 공급가액', () => {
    const r = calcPrice({
      ...REGRESSION_PARAMS,
      customer: { ...REGRESSION_PARAMS.customer, biz_type: 'simplified' },
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.vat).toBe(0);
    expect(r.vehicle_price).toBe(r.supply_price);
  });

  it('법인사업자 → 지방보조금·소상공인·택배 보조금 0', () => {
    const r = calcPrice({
      ...REGRESSION_PARAMS,
      customer: {
        biz_type: 'corporation', is_sosang: false,
        has_transport_license: true, diesel_conversion: false,
      },
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.subsidy_local).toBe(0);
    expect(r.subsidy_sosang).toBe(0);
    expect(r.subsidy_takbae).toBe(0);
  });

  it('법인 + 경유차 전환 → 경유차 보조금 −500,000', () => {
    const r = calcPrice({
      ...REGRESSION_PARAMS,
      customer: {
        biz_type: 'corporation', is_sosang: false,
        has_transport_license: false, diesel_conversion: true,
      },
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.subsidy_diesel).toBe(-500_000);
  });

  it('택배 보조금 = 국고×10% (운송허가O + 개인사업자에서만)', () => {
    const withLicense = calcPrice(REGRESSION_PARAMS);
    const noLicense = calcPrice({
      ...REGRESSION_PARAMS,
      customer: { ...REGRESSION_PARAMS.customer, has_transport_license: false },
    });
    if (withLicense.status !== 'ok' || noLicense.status !== 'ok') throw new Error('expected ok');
    expect(withLicense.subsidy_takbae).toBe(1_150_000);
    expect(noLicense.subsidy_takbae).toBe(0);
  });

  it('특장옵션 추가 시 공급가액·특장취득세 반영', () => {
    // 도어옵션 슬라이딩(280,000) 추가 → option_sum += 280,000
    const r = calcPrice({ ...REGRESSION_PARAMS, option_sum: 16_700_000 + 280_000 });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.supply_price).toBe(59_280_000);
    expect(r.reg_special_acq_tax).toBe(Math.floor(16_980_000 * 0.02)); // 339,600
  });
});
