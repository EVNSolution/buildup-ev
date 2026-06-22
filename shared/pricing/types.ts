export type BizType = 'individual' | 'corporation' | 'simplified';

export interface DoorPrices {
  base_swing_price: number;
  selected_price: number;
  has_extra: boolean;
}

export interface TaxConfig {
  acq_tax_rate: number;
  special_acq_tax_rate: number;
  acq_tax_relief_cap: number;
  stamp: number;
  plate: number;
  reg_agency: number;
  delivery_fee: number;
  etc_fee: number;
}

export interface PricingParams {
  bodytype_code: string;
  trim_code: string;
  selected_value_codes: string[];
  door: DoorPrices;
  option_prices: Record<string, number>;
  subsidy_national: number;
  subsidy_sosang_rate: number;
  subsidy_local: number;
  tax: TaxConfig;
  customer: {
    biz_type: BizType;
    is_sosang: boolean;
  };
}

export interface PricingOk {
  status: 'ok';
  supply_price: number;
  vat: number;
  vehicle_price: number;
  subsidy_national: number;
  subsidy_local: number;
  subsidy_sosang: number;
  subsidy_scrap: number;
  subsidy_total: number;
  applied_price: number;
  vat_refunded_price: number;
  reg_acq_tax: number;
  reg_acq_tax_relief: number;
  reg_special_acq_tax: number;
  reg_stamp: number;
  reg_plate: number;
  reg_agency: number;
  reg_cost: number;
  delivery_fee: number;
  etc_fee: number;
  etc_cost: number;
  real_price: number;
}

export interface PricingUnsupported {
  status: 'unsupported';
  reason: string;
}

export type PricingResult = PricingOk | PricingUnsupported;
