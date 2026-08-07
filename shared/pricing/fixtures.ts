// 회귀 픽스처 — 견적서_Ver1.21 '범석환' 케이스 (시트값 그대로).
// 베이직 + 냉장/냉동 저상 + (쿠팡='불가'→0) + 온도X + 격벽X + 개인사업자 + 소상공인 + 택배 + 경북 울릉군
// 실구매가 = ₩32,013,860
//
// ※ 쿠팡미닫이 '불가'→슬라이딩 치환은 데이터/라우트 계층 규칙이라 코어 픽스처엔 시트대로 0 반영.

import type { PricingParams } from './types.js';

export const REGRESSION_PARAMS: PricingParams = {
  trim_price: 42_300_000,  // 베이직 (D13)
  option_sum: 16_700_000,  // 냉장/냉동 저상 탑 (D15) + 나머지 0
  subsidy: {
    national:          11_500_000,
    local:             12_040_000,   // 경북 울릉군
    sosang_rate:       0.3,
    takbae_rate:       0.1,
    diesel_conversion: -500_000,
  },
  tax: {
    acq_tax_rate:         0.05,
    special_acq_tax_rate: 0.02,
    acq_tax_relief_cap:   1_400_000,
    stamp:       2_000,
    plate:      28_000,
    reg_agency: 30_000,
    delivery_fee: 179_000,
    etc_fee:     50_000,
  },
  customer: {
    biz_type: 'individual',
    is_sosang: true,
    has_transport_license: true,
    diesel_conversion: false,
  },
};

export const REGRESSION_REAL_PRICE = 32_013_860;

// ─────────────────────────────────────────────────────────────────────────────
// 총견적서 회귀 픽스처 — STEGO-K1_총견적서.xlsx '입력 시트'/'차량견적서' (정재성 케이스).
// 플러스 + 냉장/냉동저상 + 슬라이딩 + 도어추가O + 온도O + 격벽 이동식(저상)
// + 개인사업자 + 소상공인O + 화물운송O + 영업용번호판O + 경유차전환 + 경기 군포시
// + 선수금 30% + 60개월. 값은 엑셀 셀 계산값(data_only) = ground truth.
// 단가는 VAT 포함(엑셀 옵션DB 정책). calcQuote 검증용.

import type { QuoteParams } from './quote.js';

export const QUOTE_PARAMS: QuoteParams = {
  car_price: 49_650_000,        // D10 플러스(VAT포함, 옵션DB R3)
  delivery_fee: 188_000,        // D11 (옵션DB X4)
  commercial_discount: 700_000, // D12 (X2)
  partnership_rate: 0.01,       // D13
  subsidy_national: 11_500_000, // AA2
  diesel_conversion: true,      // C5 → 국고 −500,000
  diesel_deduction: 500_000,
  subsidy_local: 5_290_000,     // N 경기 군포시
  is_corporation: false,
  is_sosang: true,              // C4
  sosang_rate: 0.3,             // D17
  is_individual: true,
  has_transport_license: true,  // C6
  takbae_rate: 0.1,             // D18
  body_price: 21_619_000,       // I16 특장가격 합계(VAT포함)
  promotion: 0,                 // I18
  car_deposit: 100_000,         // D21
  body_deposit: 400_000,        // I21
  down_payment_rate: 0.3,       // G5
  installment_months: 60,       // G6
  installment_rate: 0.066,      // M21 (옵션DB AG5, 60개월)
  has_biz_plate: true,          // C7 → 취득세 4%
  acq_tax_rate_biz: 0.04,
  acq_tax_rate_normal: 0.05,
  acq_tax_relief: 1_400_000,
  special_acq_tax_rate: 0.02,
  is_seoul_normal: false,       // 경기(서울 아님)
  bond_discount: 31_648,        // X9
  plate: 28_000,                // X6
  stamp: 2_000,                 // X5
  insurance: 2_800,             // X8 (총견적서는 등록비 포함)
  reg_agency: 30_000,           // X7
  etc_fee: 50_000,              // AD2
  // 총견적서 엑셀에는 구조변경 비용 항목이 없다 — 정답지 재현을 깨지 않도록 0.
  // 운영 기본값(400,000)은 tax_config 에서 주입되며, 별도 테스트로 검증한다.
  structure_change_fee: 0,
};

/** 차량견적서 시트 계산값(ground truth). 월납입금·이자는 float → 근사 비교. */
export const QUOTE_EXPECTED = {
  partnership_discount: 489_500,   // D13
  purchase_benefit: -1_189_500,    // D14
  subsidy_national: 11_000_000,    // D15 (경유차 조정 후)
  subsidy_local: 5_290_000,        // D16
  subsidy_sosang: 3_300_000,       // D17
  subsidy_takbae: 1_100_000,       // D18
  subsidy_total: -20_690_000,      // D19
  car_payment: 27_958_500,         // D20
  down_payment: 14_723_250,        // D22
  car_delivery: 14_823_250,        // D23
  car_acq_tax: 369_030,            // D24
  car_reg_cost: 431_830,           // D30
  car_initial: 15_255_080,         // D31
  body_payment: 21_619_000,        // I20
  body_delivery: 400_000,          // I23
  body_acq_tax: 432_380,           // I24
  body_reg_cost: 482_380,          // I30
  body_initial: 882_380,           // I31
  car_installment: 13_135_250,     // L18
  body_installment: 21_219_000,    // M18
  total_installment: 34_354_250,   // L19
  monthly_payment: 673_790.6649724458,       // M24 (PMT)
  installment_interest: 6_073_189.898346752, // M22
  vat_refund_price: 45_070_450,    // M26
};
