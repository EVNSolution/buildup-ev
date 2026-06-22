// 회귀 픽스처: TRIM_PLUS+저상+슬라이딩+ADD없음+온도O+그물망+개인사업자+소상공인+경기남양주
// 실구매가 기준: ₩46,471,818

import type { PricingParams } from './types.js';

export const REGRESSION_PARAMS: PricingParams = {
  bodytype_code: 'BODY_REEFER',
  trim_code: 'TRIM_PLUS',
  selected_value_codes: [
    'TRIM_PLUS', 'BODY_REEFER', 'TOP_LOW',
    'DOOR_SLIDE', 'ADD_NONE', 'TEMP_O', 'PART_NET',
  ],
  door: {
    base_swing_price: 480_000,
    selected_price:   760_000,
    has_extra: false,
  },
  option_prices: {
    TRIM_BASIC:   43_500_000,
    TRIM_PLUS:    45_136_364,
    TOP_LOW:      17_300_000,
    TOP_STD:      17_600_000,
    TEMP_O:          450_000,
    PART_NET:        170_000,
    PART_REEFER:     300_000,
    SPOILER_O:       500_000,
  },
  subsidy_national:     11_500_000,
  subsidy_sosang_rate:  0.3,
  subsidy_local:         3_450_000,
  tax: {
    acq_tax_rate:         0.05,
    special_acq_tax_rate: 0.02,
    acq_tax_relief_cap:   1_400_000,
    stamp:       2_500,
    plate:      25_000,
    reg_agency: 50_000,
    delivery_fee: 179_000,
    etc_fee:     50_000,
  },
  customer: {
    biz_type: 'individual',
    is_sosang: true,
  },
};

export const REGRESSION_REAL_PRICE = 46_471_818;
