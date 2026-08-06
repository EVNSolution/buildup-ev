import { describe, it, expect } from 'vitest';
import { calcPrice } from './core.js';
import { calcQuote } from './quote.js';
import { assembleOptionSum, optionBreakdown } from './assemble.js';
import { REGRESSION_PARAMS, QUOTE_PARAMS } from './fixtures.js';

/**
 * 재량할인(프로모션) · 일반구매자 · 지방보조금 토글 회귀.
 * 핵심: 할인은 **단가 조립 단계**에서 0원 처리되므로 calcPrice(화면·저장)·calcQuote(견적서)가
 *       동일하게 반영된다(이전 버그: calcQuote 에만 반영되어 화면 총액이 안 맞음).
 */

// 옵션 단가(공급가) — 조립 함수 검증용
const PRICES: Record<string, number> = {
  TRIM_PLUS: 45_136_364,
  TOP_REEFER_LOW: 17_563_636,
  SPL_LOW: 400_000,
  DOPT_REEFER_LOW_SLIDE: 280_000,
  DADD_REEFER_LOW_SLIDE: 760_000,
  TEMP_O: 450_000,
  PART_LOW_MOVE: 600_000,
};
const price = (c: string) => PRICES[c] ?? 0;
const SEL = {
  TRIM: 'TRIM_PLUS', BODYTYPE: 'BODY_REEFER', TOP: 'TOP_LOW', DOORTYPE: 'DOOR_SLIDE',
  DOORADD: 'ADD_DRIVER', SPOILER: 'SPOILER_O', TEMP: 'TEMP_O', PARTITION: 'PART_REEFER',
};
const FULL_SUM = 17_563_636 + 400_000 + 280_000 + 760_000 + 450_000 + 600_000;

describe('재량할인(프로모션) — 조립 단계 0원 처리', () => {
  it('할인 없으면 전체 합계', () => {
    expect(assembleOptionSum(SEL, price).option_sum).toBe(FULL_SUM);
  });

  it('그룹 하나 0원 처리 → 해당 단가만큼 정확히 감소', () => {
    const r = assembleOptionSum(SEL, price, ['TOP']);
    expect(r.option_sum).toBe(FULL_SUM - 17_563_636);
    expect(r.trim_price).toBe(45_136_364); // 트림은 특장할인 대상 아님
  });

  it('여러 그룹 동시 0원 처리', () => {
    const r = assembleOptionSum(SEL, price, ['SPOILER', 'TEMP', 'PARTITION']);
    expect(r.option_sum).toBe(FULL_SUM - 400_000 - 450_000 - 600_000);
  });

  it('전 그룹 0원 처리 → 특장 합계 0', () => {
    const all = ['TOP', 'SPOILER', 'DOORTYPE', 'DOORADD', 'TEMP', 'PARTITION'];
    expect(assembleOptionSum(SEL, price, all).option_sum).toBe(0);
  });

  it('breakdown: 0원 처리된 그룹만 0, 나머지는 유지 (견적서 개별 행 표기)', () => {
    const bd = optionBreakdown(SEL, price, ['DOORADD']);
    expect(bd['DOORADD']).toBe(0);
    expect(bd['TOP']).toBe(17_563_636);
    expect(bd['DOORTYPE']).toBe(280_000);
  });

  it('없는 그룹코드를 넘겨도 무시(안전)', () => {
    expect(assembleOptionSum(SEL, price, ['NOPE']).option_sum).toBe(FULL_SUM);
  });

  it('calcPrice(화면·저장): 할인분이 공급가·부가세·특장취득세·실구매가에 모두 반영', () => {
    const base = calcPrice(REGRESSION_PARAMS);
    const discounted = calcPrice({ ...REGRESSION_PARAMS, option_sum: REGRESSION_PARAMS.option_sum - 1_000_000 });
    if (base.status !== 'ok' || discounted.status !== 'ok') throw new Error('expected ok');
    expect(base.supply_price - discounted.supply_price).toBe(1_000_000);
    expect(base.vat - discounted.vat).toBe(100_000);                       // 부가세도 감소
    expect(base.reg_special_acq_tax - discounted.reg_special_acq_tax).toBe(20_000); // 특장취득세 2%
    expect(discounted.real_price).toBeLessThan(base.real_price);           // 실구매가 감소
  });

  it('calcQuote(견적서): 할인분이 특장가격·결제금액·취득세·할부에 반영', () => {
    const base = calcQuote(QUOTE_PARAMS);
    const discounted = calcQuote({ ...QUOTE_PARAMS, body_price: QUOTE_PARAMS.body_price - 1_100_000 });
    expect(base.body_price - discounted.body_price).toBe(1_100_000);
    expect(base.body_payment - discounted.body_payment).toBe(1_100_000);
    expect(discounted.body_acq_tax).toBeLessThan(base.body_acq_tax);       // 특장취득세 2%
    expect(discounted.total_installment).toBeLessThan(base.total_installment);
    expect(discounted.monthly_payment).toBeLessThan(base.monthly_payment);
  });

  it('promotion 라인은 0 — 할인이 단가에 이미 반영되어 이중차감 없음', () => {
    const r = calcQuote({ ...QUOTE_PARAMS, promotion: 0 });
    expect(r.promotion).toBe(0);
    expect(r.body_payment).toBe(r.body_price); // ⑦=결제금액
  });
});

describe('일반구매자(consumer) — 부가세 환급 불가', () => {
  it('calcPrice: 부가세는 부과되지만 환급 차감 없음 (택배보조금 변수 제거해 환급 효과만 비교)', () => {
    // has_transport_license=false 로 고정 — 택배보조금(개인사업자 전용) 차이를 제거하고
    // 순수하게 '부가세 환급 불가' 효과만 검증한다.
    const noLicense = { ...REGRESSION_PARAMS.customer, has_transport_license: false };
    const biz = calcPrice({ ...REGRESSION_PARAMS, customer: noLicense });
    const consumer = calcPrice({ ...REGRESSION_PARAMS, customer: { ...noLicense, biz_type: 'consumer' } });
    if (biz.status !== 'ok' || consumer.status !== 'ok') throw new Error('expected ok');
    expect(consumer.vat).toBe(biz.vat);                              // 부가세 자체는 동일 부과
    expect(consumer.vat_refunded_price).toBe(consumer.applied_price); // 환급 차감 없음
    expect(consumer.real_price - biz.real_price).toBe(biz.vat);      // 환급 못 받는 만큼 비쌈
  });

  it('일반구매자는 택배 보조금 대상 아님(개인사업자 전용)', () => {
    const consumer = calcPrice({
      ...REGRESSION_PARAMS,
      customer: { ...REGRESSION_PARAMS.customer, biz_type: 'consumer' },
    });
    const individual = calcPrice(REGRESSION_PARAMS);
    if (consumer.status !== 'ok' || individual.status !== 'ok') throw new Error('expected ok');
    expect(individual.subsidy_takbae).toBe(1_150_000);
    expect(consumer.subsidy_takbae).toBe(0);
  });

  it('calcQuote: 부가세 환급 시 가격 = 0원 표기', () => {
    const normal = calcQuote(QUOTE_PARAMS);
    const consumer = calcQuote({ ...QUOTE_PARAMS, no_vat_refund: true });
    expect(normal.vat_refund_price).toBeGreaterThan(0);
    expect(consumer.vat_refund_price).toBe(0);
    expect(consumer.car_payment).toBe(normal.car_payment); // 결제금액엔 영향 없음
  });

  it('일반구매자도 지방보조금은 받는다(법인만 0)', () => {
    const consumer = calcQuote({ ...QUOTE_PARAMS, no_vat_refund: true });
    expect(consumer.subsidy_local).toBe(QUOTE_PARAMS.subsidy_local);
  });
});

describe('지방보조금 토글(예산 소진)', () => {
  it('off → 지방보조금 0, 차량 결제금액이 그만큼 증가', () => {
    const on = calcQuote(QUOTE_PARAMS);
    const off = calcQuote({ ...QUOTE_PARAMS, local_subsidy_off: true });
    expect(on.subsidy_local).toBe(5_290_000);
    expect(off.subsidy_local).toBe(0);
    expect(off.car_payment - on.car_payment).toBe(5_290_000);
  });

  it('off 여도 국고·소상공인·택배 보조금은 유지', () => {
    const off = calcQuote({ ...QUOTE_PARAMS, local_subsidy_off: true });
    expect(off.subsidy_national).toBe(11_000_000);
    expect(off.subsidy_sosang).toBe(3_300_000);
    expect(off.subsidy_takbae).toBe(1_100_000);
  });

  it('법인 + off 중복이어도 0(중복 차감 없음)', () => {
    const r = calcQuote({ ...QUOTE_PARAMS, is_corporation: true, local_subsidy_off: true });
    expect(r.subsidy_local).toBe(0);
  });
});

describe('복합 시나리오 (할인 + 토글 + 일반구매자)', () => {
  it('세 조건 동시 적용 시 각각 독립적으로 반영', () => {
    const base = calcQuote(QUOTE_PARAMS);
    const combo = calcQuote({
      ...QUOTE_PARAMS,
      body_price: QUOTE_PARAMS.body_price - 1_100_000, // 재량할인
      local_subsidy_off: true,                          // 지방보조금 미적용
      no_vat_refund: true,                              // 일반구매자
    });
    expect(base.body_payment - combo.body_payment).toBe(1_100_000);
    expect(combo.subsidy_local).toBe(0);
    expect(combo.vat_refund_price).toBe(0);
    // 차량결제 = 지방보조금만큼 증가, 특장결제 = 할인만큼 감소
    expect(combo.car_payment - base.car_payment).toBe(5_290_000);
  });

  it('기존 회귀 픽스처는 영향 없음(할인·토글 미지정 시)', () => {
    const r = calcQuote(QUOTE_PARAMS);
    expect(r.car_payment).toBe(27_958_500);
    expect(r.body_payment).toBe(21_619_000);
    expect(r.vat_refund_price).toBe(45_070_450);
  });
});

describe('실구매가(real_price) — 총견적서 기준 단일 소스', () => {
  it('= 부가세 환급 시 가격 + 차량 등록/부대 + 특장 등록/부대', () => {
    const r = calcQuote(QUOTE_PARAMS);
    expect(r.real_price).toBe(r.vat_refund_price + r.car_reg_cost + r.body_reg_cost);
  });

  it('일반구매자는 환급 못 받으므로 결제금액(VAT포함) 기준 — 환급가 0에 끌려가지 않는다', () => {
    const normal = calcQuote(QUOTE_PARAMS);
    const consumer = calcQuote({ ...QUOTE_PARAMS, no_vat_refund: true });
    expect(consumer.vat_refund_price).toBe(0);
    // 환급분(부가세)만큼 더 부담 → 일반구매자가 더 비싸다
    expect(consumer.real_price).toBeGreaterThan(normal.real_price);
    expect(consumer.real_price).toBe(
      consumer.car_payment + consumer.body_payment + consumer.car_reg_cost + consumer.body_reg_cost,
    );
  });
});
