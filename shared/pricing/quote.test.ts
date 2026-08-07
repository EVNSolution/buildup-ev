import { describe, it, expect } from 'vitest';
import { calcQuote, pmt } from './quote.js';
import { QUOTE_PARAMS, QUOTE_EXPECTED } from './fixtures.js';

describe('calcQuote — 총견적서 계산 코어 (STEGO-K1_총견적서.xlsx)', () => {
  const r = calcQuote(QUOTE_PARAMS);

  it('차량 결제 금액·구매혜택·보조금 (D13~D20) = 엑셀 값', () => {
    expect(r.partnership_discount).toBe(QUOTE_EXPECTED.partnership_discount);
    expect(r.purchase_benefit).toBe(QUOTE_EXPECTED.purchase_benefit);
    expect(r.subsidy_national).toBe(QUOTE_EXPECTED.subsidy_national);
    expect(r.subsidy_local).toBe(QUOTE_EXPECTED.subsidy_local);
    expect(r.subsidy_sosang).toBe(QUOTE_EXPECTED.subsidy_sosang);
    expect(r.subsidy_takbae).toBe(QUOTE_EXPECTED.subsidy_takbae);
    expect(r.subsidy_total).toBe(QUOTE_EXPECTED.subsidy_total);
    expect(r.car_payment).toBe(QUOTE_EXPECTED.car_payment);
  });

  it('계약금·선수금·인도금 (D22~D23, I23) = 엑셀 값', () => {
    expect(r.down_payment).toBe(QUOTE_EXPECTED.down_payment);
    expect(r.car_delivery).toBe(QUOTE_EXPECTED.car_delivery);
    expect(r.body_delivery).toBe(QUOTE_EXPECTED.body_delivery);
  });

  it('취득세·등록/부대비용 (D24/D30/D31, I24/I30/I31) = 엑셀 값', () => {
    expect(r.car_acq_tax).toBe(QUOTE_EXPECTED.car_acq_tax);
    expect(r.car_reg_cost).toBe(QUOTE_EXPECTED.car_reg_cost);
    expect(r.car_initial).toBe(QUOTE_EXPECTED.car_initial);
    expect(r.body_payment).toBe(QUOTE_EXPECTED.body_payment);
    expect(r.body_acq_tax).toBe(QUOTE_EXPECTED.body_acq_tax);
    expect(r.body_reg_cost).toBe(QUOTE_EXPECTED.body_reg_cost);
    expect(r.body_initial).toBe(QUOTE_EXPECTED.body_initial);
  });

  it('할부 (L18/M18/L19, M24/M22/M26) = 엑셀 값', () => {
    expect(r.car_installment).toBe(QUOTE_EXPECTED.car_installment);
    expect(r.body_installment).toBe(QUOTE_EXPECTED.body_installment);
    expect(r.total_installment).toBe(QUOTE_EXPECTED.total_installment);
    expect(r.monthly_payment).toBeCloseTo(QUOTE_EXPECTED.monthly_payment, 4);
    expect(r.installment_interest).toBeCloseTo(QUOTE_EXPECTED.installment_interest, 4);
    expect(r.vat_refund_price).toBe(QUOTE_EXPECTED.vat_refund_price);
  });

  it('PMT: r=0(일시불) → 원금/개월수', () => {
    expect(pmt(0, 60, 6_000_000)).toBe(100_000);
  });

  it('법인사업자 → 지방보조금·소상공인·택배 0', () => {
    const c = calcQuote({ ...QUOTE_PARAMS, is_corporation: true, is_individual: false, is_sosang: false });
    expect(c.subsidy_local).toBe(0);
    expect(c.subsidy_sosang).toBe(0);
    expect(c.subsidy_takbae).toBe(0);
  });

  it('서울+일반인 → 공채할인액 반영, 그 외 0', () => {
    const seoul = calcQuote({ ...QUOTE_PARAMS, is_seoul_normal: true });
    expect(seoul.bond_discount).toBe(QUOTE_PARAMS.bond_discount);
    expect(r.bond_discount).toBe(0);
  });
});

describe('구조변경 비용 — 특장 등록/부대비용 3번째 항목', () => {
  it('⑩ 등록/부대비용 = 특장취득세 + 등록부가수수료 + 구조변경비용', () => {
    const r = calcQuote({ ...QUOTE_PARAMS, structure_change_fee: 400_000 });
    expect(r.body_reg_cost).toBe(r.body_acq_tax + r.etc_fee + 400_000);
  });

  it('실구매가에 그대로 더해진다', () => {
    const base = calcQuote(QUOTE_PARAMS);
    const withFee = calcQuote({ ...QUOTE_PARAMS, structure_change_fee: 400_000 });
    expect(withFee.real_price - base.real_price).toBe(400_000);
  });

  it('탑 단가를 낮춰 자리를 옮기면 총액은 줄지만 실구매가는 오른다(환급 감소)', () => {
    // 탑 종류 40만원(VAT 포함) 인하 + 구조변경 비용 40만원 신설
    const before = calcQuote(QUOTE_PARAMS);
    const after = calcQuote({
      ...QUOTE_PARAMS,
      body_price: QUOTE_PARAMS.body_price - 400_000,
      structure_change_fee: 400_000,
    });
    expect(after.body_payment).toBe(before.body_payment - 400_000);   // 특장가격은 40만 감소
    expect(after.vat_refund_price).toBeLessThan(before.vat_refund_price); // 환급 대상도 감소
    expect(after.real_price).toBeGreaterThan(before.real_price);       // 환급이 줄어 실구매가는 상승
  });

  it('미설정(0)이면 기존과 동일 — 엑셀 정답지 불변', () => {
    expect(calcQuote(QUOTE_PARAMS).body_reg_cost)
      .toBe(calcQuote(QUOTE_PARAMS).body_acq_tax + QUOTE_PARAMS.etc_fee);
  });
});
