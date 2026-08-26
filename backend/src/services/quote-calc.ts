/**
 * 총견적서(calcQuote) 입력 빌드 — 라우트(POST /calculate-total, GET /:id/total)와
 * 견적서 PDF(quote-pdf.ts)가 공유. DB(옵션단가·보조금·세율·이율) + selections + 고객/견적 입력 조립.
 * 단가는 공급가(OptionPrice) 저장 정책 유지 → VAT포함 = round(공급가×1.1)로 환산해 주입.
 */
import { prisma } from '../lib/prisma.js';
import {
  assembleOptionSum, TAKBAE_RATE, DEFAULT_TAX_EXEMPT_TYPE,
  dieselDeducts, toDieselStatus, type QuoteParams,
  bodyOnlyParams,
  vehicleOnlyParams,
} from '@buildup-ev/shared/pricing';

export type CustomerInput = {
  name?: string;
  ceo_name?: string;                 // 대표이사 — 법인사업자일 때만(계약서 매수인 서명블록)
  email?: string;
  phone?: string;
  biz_type?: string;
  is_sosang?: boolean;
  region?: string;
  address?: string;                  // 주소(계약서·서류용)
  address_detail?: string;           // 동·호수 등 상세주소
  has_transport_license?: boolean;  // 화물자동차 운송사업허가증
  /**
   * 경유차 폐차여부(총견적서 '입력 시트' C5) — 'none' | 'keep' | 'scrap'.
   * 국고보조금을 깎는 것은 'keep'(유지)뿐이다. 'scrap'(폐차)은 금액에 영향이 없다.
   */
  diesel_status?: string;
  /** @deprecated 옛 견적 하위호환 — diesel_status 가 없을 때만 'keep' 여부로 해석된다. */
  diesel_conversion?: boolean;
  has_biz_plate?: boolean;          // 영업용 번호판 보유 → 취득세 4%
  tax_exempt_type?: string;         // 면세구분('일반인' 등) — 공채할인 판정
  // ── 계약서 전용 입력(견적 저장 시 함께 받음). 계산에는 쓰이지 않고 inputs 에 저장만 된다. ──
  contract_party?: string;
  buyer_agent?: string;
  buyer_relation?: string;
  buyer_regno?: string;
  buyer_tel?: string;
};

/** 총견적서 견적단위 입력(선수금 비율·할부개월수·재량할인). */
export type QuoteExtraInput = {
  down_payment_rate?: number;    // 선수금 비율 (0~1)
  down_payment_amount?: number | null;  // 선수금 금액(원). null = 금액 기준을 풀고 비율로 되돌림
  installment_months?: number;   // 할부개월수 (0=일시불)
  /**
   * ⚠️ **옛 방식**: 0원 처리할 특장옵션 그룹코드. 새 견적에서는 쓰지 않는다.
   *    운영에 이 방식으로 만든 견적이 남아 있어(2026-08 기준 11건, 대부분 견적확정)
   *    계산을 그대로 둔다 — 걷어내면 그 견적들의 금액이 소급해 바뀐다.
   */
  promotion_zeroed?: string[];
  /**
   * 프로모션 할인액(원, **VAT 포함**). 특장 가격에서 그대로 뺀다 —
   * 취득세·부가세환급·실구매가가 모두 이 값을 따라 움직인다(I18→I20).
   */
  promotion_discount?: number;
  local_subsidy_off?: boolean;   // 견적별 지방보조금 미적용(영업 토글)
  /**
   * **특장만 견적** — 고객이 차를 이미 갖고 있어 특장만 얹는다.
   * 차량에 딸린 입력을 통째로 0으로 만든다(shared 의 `bodyOnlyParams` 한 곳에서).
   */
  body_only?: boolean;
  /** 차량만 견적 — 특장을 얹지 않는다. body_only 와 동시에 참일 수 없다. */
  vehicle_only?: boolean;
};

export async function buildQuoteParams(
  model_code: string,
  selections: Record<string, string>,
  customer: CustomerInput | undefined,
  extra: QuoteExtraInput | undefined,
  calcYear: number,
): Promise<QuoteParams> {
  if (!prisma) throw new Error('DB_UNAVAILABLE');
  const months = extra?.installment_months ?? 0;

  const [optionPrices, subsidyNat, subsidyLoc, taxRows, instRate] = await Promise.all([
    prisma.optionPrice.findMany({ where: { model_code } }),
    prisma.subsidyNational.findFirst({ where: { model_code, year: calcYear } }),
    customer?.region
      ? prisma.subsidyLocal.findFirst({ where: { region: customer.region, year: calcYear } })
      : Promise.resolve(null),
    prisma.taxConfig.findMany(),
    prisma.installmentRate.findUnique({ where: { months } }),
  ]);

  const priceMap: Record<string, number> = {};
  for (const op of optionPrices) priceMap[op.value_code] = op.supply_price;
  const price = (code: string) => priceMap[code] ?? 0;
  const taxMap: Record<string, number> = {};
  for (const t of taxRows) taxMap[t.param_key] = Number(t.value);

  // 재량할인(프로모션)은 단가 조립 단계에서 0원 처리 — 특장가격·취득세·총액이 모두 자동 반영된다.
  const zeroed = extra?.promotion_zeroed ?? [];
  const { trim_price, option_sum } = assembleOptionSum(selections, price, zeroed);
  const bizType = (customer?.biz_type ?? 'individual') as
    'individual' | 'corporation' | 'simplified' | 'consumer';

  // 지방보조금 미적용: 관리자 DB 토글(subsidy_local.active=false) 또는 견적별 영업 토글
  const localOff = extra?.local_subsidy_off === true || subsidyLoc?.active === false;

  const params: QuoteParams = {
    car_price: Math.round(trim_price * 1.1),   // D10 VAT포함
    delivery_fee: taxMap['delivery_fee'] ?? 188_000,
    commercial_discount: taxMap['commercial_discount'] ?? 0,
    partnership_rate: taxMap['partnership_rate'] ?? 0.01,
    subsidy_national: subsidyNat?.amount ?? 0,
    // 「유지」일 때만 국고 −500,000(엑셀 D15). 옛 견적은 diesel_conversion boolean 으로 복원된다.
    diesel_conversion: dieselDeducts(toDieselStatus(customer?.diesel_status, customer?.diesel_conversion)),
    diesel_deduction: taxMap['diesel_deduction'] ?? 500_000,
    subsidy_local: subsidyLoc?.amount ?? 0,
    is_corporation: bizType === 'corporation',
    local_subsidy_off: localOff,
    no_vat_refund: bizType === 'consumer',
    is_sosang: customer?.is_sosang ?? false,
    sosang_rate: subsidyNat?.sosang_rate ? Number(subsidyNat.sosang_rate) : 0.3,
    is_individual: bizType === 'individual',
    has_transport_license: customer?.has_transport_license ?? false,
    takbae_rate: TAKBAE_RATE,
    body_price: Math.round(option_sum * 1.1),  // I16 VAT포함(옛 0원처리가 반영된 합계)
    /*
     * I18 프로모션 — 금액 할인.
     * 옛 방식(promotion_zeroed)은 단가를 0원으로 만들어 body_price 에 이미 녹아 있고,
     * 새 방식은 여기서 뺀다. 둘은 서로 간섭하지 않는다.
     * 음수나 특장가격 초과는 막는다 — 할인이 가격을 넘으면 금액이 뒤집힌다.
     */
    promotion: Math.min(Math.max(0, Math.round(extra?.promotion_discount ?? 0)), Math.round(option_sum * 1.1)),
    car_deposit: taxMap['car_deposit'] ?? 100_000,
    body_deposit: taxMap['body_deposit'] ?? 400_000,
    down_payment_rate: extra?.down_payment_rate ?? 0,
    // 비율/금액 중 **하나만** 기준이 된다. 금액이 있으면 계산이 그쪽을 쓴다.
    ...(extra?.down_payment_amount != null ? { down_payment_amount: extra.down_payment_amount } : {}),
    installment_months: months,
    installment_rate: instRate ? Number(instRate.rate) : 0,
    has_biz_plate: customer?.has_biz_plate ?? false,
    acq_tax_rate_biz: taxMap['acq_tax_rate_biz'] ?? 0.04,
    acq_tax_rate_normal: taxMap['acq_tax_rate'] ?? 0.05,
    acq_tax_relief: taxMap['acq_tax_relief_cap'] ?? 1_400_000,
    special_acq_tax_rate: taxMap['special_acq_tax_rate'] ?? 0.02,
    is_seoul_normal: (customer?.tax_exempt_type ?? DEFAULT_TAX_EXEMPT_TYPE) === '일반인' && customer?.region === '서울특별시',
    bond_discount: taxMap['bond_discount'] ?? 0,
    plate: taxMap['plate'] ?? 28_000,
    stamp: taxMap['stamp'] ?? 2_000,
    insurance: taxMap['insurance'] ?? 2_800,
    reg_agency: taxMap['reg_agency'] ?? 30_000,
    etc_fee: taxMap['etc_fee'] ?? 50_000,
    // 구조변경 비용 — tax_config 로 관리(관리자페이지에서 변경). 미설정 시 40만원.
    structure_change_fee: taxMap['structure_change_fee'] ?? 400_000,
  };

  /*
   * 특장만 견적이면 차량에 딸린 입력을 통째로 0으로 만든다.
   * 여기서 하나씩 0을 채우지 않고 shared 한 곳에 맡긴다 — 화면도 같은 함수를 쓰므로
   * 견적서와 화면이 다른 값을 말할 수 없다.
   */
  /*
   * 둘은 **동시에 참일 수 없다** — 그러면 팔 것이 아무것도 남지 않는다.
   * 어쩌다 둘 다 들어오면 특장만을 우선한다(먼저 있던 기능이라 기존 견적을 지킨다).
   */
  if (extra?.body_only) return bodyOnlyParams(params);
  if (extra?.vehicle_only) return vehicleOnlyParams(params);
  return params;
}
