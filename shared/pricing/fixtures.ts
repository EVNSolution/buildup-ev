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
