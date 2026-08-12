/**
 * 총견적서(STEGO-K1_총견적서.xlsx '차량견적서' 시트) 계산 코어 — calcQuote.
 *
 * 기존 calcPrice(견적서 Ver1.21, 실구매가 통합)는 그대로 두고, 총견적서의
 * **차량/특장 분리 결제 + 구매혜택 + 계약금·선수금·인도금 + 할부(PMT)** 를 신설.
 * 순수 함수 — DB 쿼리 없음. 라우트가 옵션DB/보조금/세율/이율을 조립해 주입.
 *
 * 정답지(엑셀 셀) = ground truth. 셀 대응은 각 필드 주석의 D·I·L·M 참조.
 * 입력 단가는 **VAT 포함**(엑셀 옵션DB 정책). 공급가 기반 OptionPrice 는 라우트에서 ×1.1 하여 주입.
 */

/**
 * 면세구분 기본값 — 미입력 시 이 값으로 간주한다(공채할인 판정에 사용).
 * 화면(컨피규레이터)·저장·견적서 생성 팝업이 모두 같은 기본값을 써야 금액이 어긋나지 않는다.
 */
export const DEFAULT_TAX_EXEMPT_TYPE = '일반인';

/** 원리금균등상환 월 납입금 (엑셀 PMT 재현). r=월이율, n=개월수, principal=할부원금. */
export function pmt(monthlyRate: number, months: number, principal: number): number {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/** ROUNDDOWN(x, -10) — 10원 단위 내림 (엑셀 ROUNDDOWN(...,-10)). */
function floor10(x: number): number {
  return Math.floor(x / 10) * 10;
}

/**
 * 경유차 폐차여부 — 총견적서 '입력 시트' C5 의 3지 선택을 그대로 옮긴 것.
 *   none  경유차없음
 *   keep  경유차 유지 후 전기차 전환   ← **국고보조금 −500,000**
 *   scrap 경유차 폐차 후 전기차 전환   ← 보조금 영향 **없음**
 *
 * ⚠️ 엑셀 차량견적서 D15 수식이 정답지다:
 *     =IF('입력 시트'!C5="경유차 유지 후 전기차 전환", 옵션DB!AA2-500000, 옵션DB!AA2)
 *    「폐차」는 선택지로만 존재하고 금액을 바꾸지 않는다(「경유차없음」과 같다).
 *    감액은 사업자 구분과 **무관**하다 — 법인 조건이 붙어 있지 않다.
 */
export type DieselStatus = 'none' | 'keep' | 'scrap';

/** 계약서·견적서에 인쇄할 표기(엑셀 C5 선택지 문구 그대로). */
export const DIESEL_STATUS_LABEL: Record<DieselStatus, string> = {
  none: '경유차없음',
  keep: '경유차 유지 후 전기차 전환',
  scrap: '경유차 폐차 후 전기차 전환',
};

/**
 * 국고보조금이 깎이는 경우인가 = 「유지」뿐.
 * calcQuote 의 `diesel_conversion` 는 이 판정 결과를 받는다.
 */
export function dieselDeducts(status: DieselStatus): boolean {
  return status === 'keep';
}

/**
 * 저장된 값 → DieselStatus. 하위호환:
 * 예전 견적은 `diesel_conversion: boolean`(= 유지 여부)만 갖고 있어 그것으로 복원한다.
 */
export function toDieselStatus(status: unknown, legacyConversion?: unknown): DieselStatus {
  if (status === 'none' || status === 'keep' || status === 'scrap') return status;
  return legacyConversion === true ? 'keep' : 'none';
}

export interface QuoteParams {
  // ── 차량 (VAT 포함) ──
  car_price: number;            // D10 차량가격(트림, VAT포함)
  delivery_fee: number;         // D11 탁송료
  commercial_discount: number;  // D12 현대커머셜 할인
  partnership_rate: number;     // D13 파트너십 할인율 (0.01)

  // ── 보조금 ──
  subsidy_national: number;     // AA2 국고보조금(경유차 조정 전)
  diesel_conversion: boolean;   // C5 경유차 유지 후 전기차 전환
  diesel_deduction: number;     // 경유차 전환 시 국고 차감액 (500,000)
  subsidy_local: number;        // N 지역 지방보조금
  is_corporation: boolean;      // 법인사업자 → 지방보조금 0
  local_subsidy_off?: boolean;  // 지방보조금 소진/미적용(관리자 DB 토글 또는 견적별 영업 토글) → 0
  no_vat_refund?: boolean;      // 일반구매자(비사업자) → 부가세 환급 0원
  is_sosang: boolean;           // C4 소상공인
  sosang_rate: number;          // D17 소상공인 할인율 (국고 대비, 0.3)
  is_individual: boolean;       // 개인사업자
  has_transport_license: boolean; // C6 화물운송허가증
  takbae_rate: number;          // D18 택배업 보조금율 (국고 대비, 0.1)

  // ── 특장 (VAT 포함) ──
  body_price: number;           // I16 특장가격(옵션 합계)
  promotion: number;            // I18 프로모션(특장, 0)

  // ── 계약금·선수금·할부 ──
  car_deposit: number;          // D21 차량 계약금
  body_deposit: number;         // I21 특장 계약금
  down_payment_rate: number;    // G5 선수금 비율
  installment_months: number;   // G6 할부개월수
  installment_rate: number;     // M21 연이율 (일시불=0)

  // ── 취득세·등록/부대 ──
  has_biz_plate: boolean;       // C7 영업용 번호판 보유 → 취득세 4%
  acq_tax_rate_biz: number;     // 0.04
  acq_tax_rate_normal: number;  // 0.05
  acq_tax_relief: number;       // 1,400,000 취득세 감면
  special_acq_tax_rate: number; // 0.02 특장 취득세율
  is_seoul_normal: boolean;     // 면세구분='일반인' AND 지역='서울특별시'
  bond_discount: number;        // X9 공채할인액 (서울+일반인만)
  plate: number;                // D26 번호판금액
  stamp: number;                // D27 증지대
  insurance: number;            // D28 의무보험료 (총견적서는 등록비 포함)
  reg_agency: number;           // D29 등록대행료
  etc_fee: number;              // I25 등록부가수수료
  /**
   * 구조변경 비용 — 특장 등록/부대비용의 세 번째 항목(VAT 포함).
   * 이 금액만큼 탑 종류 단가를 낮춰 특장가격에서 등록/부대비용으로 자리를 옮긴 것.
   * (자리를 옮기면 부가세 환급 대상 금액이 줄어 실구매가가 그만큼 올라간다 — 의도된 동작)
   */
  structure_change_fee: number;
}

export interface QuoteResult {
  // 차량 축
  car_price: number;            // D10
  delivery_fee: number;         // D11
  commercial_discount: number;  // D12
  partnership_discount: number; // D13
  purchase_benefit: number;     // D14 (음수)
  subsidy_national: number;     // D15 (경유차 조정 후)
  subsidy_local: number;        // D16
  subsidy_sosang: number;       // D17
  subsidy_takbae: number;       // D18
  subsidy_total: number;        // D19 (음수)
  car_payment: number;          // D20 차량 결제 금액
  car_deposit: number;          // D21
  down_payment: number;         // D22 선수금(전액 차량측)
  car_delivery: number;         // D23 인도금(차량)
  car_acq_tax: number;          // D24
  bond_discount: number;        // D25
  plate: number; stamp: number; insurance: number; reg_agency: number; // D26~D29
  car_reg_cost: number;         // D30 등록/부대비용
  car_initial: number;          // D31 차량 초기 납부 금액

  // 특장 축
  body_price: number;           // I16
  promotion: number;            // I18
  body_payment: number;         // I20 특장 결제 금액
  body_deposit: number;         // I21
  body_delivery: number;        // I23 인도금(특장)
  body_acq_tax: number;         // I24
  etc_fee: number;              // I25
  structure_change_fee: number; // I25-2 구조변경 비용
  body_reg_cost: number;        // I30
  body_initial: number;         // I31 특장 초기 납부 금액

  // 할부
  car_installment: number;      // L18
  body_installment: number;     // M18
  total_installment: number;    // L19 총할부금(원금)
  installment_rate: number;     // M21
  installment_months: number;   // M23
  monthly_payment: number;      // M24 월 납입금
  installment_interest: number; // M22 할부이자
  vat_refund_price: number;     // M26 부가세 환급 시 가격
  /**
   * 실구매가 — 총견적서엔 없는 항목이라 Ver1.21 의 정의(②부가세환급후 + ③등록비 + ④기타)를
   * 총견적서 축으로 옮겨 정의한다: 부가세 환급 시 가격 + 차량 등록/부대 + 특장 등록/부대.
   * (탁송료·구매혜택·보조금은 이미 차량 결제금액에 반영되어 있다)
   * 화면 가격바와 견적 목록이 견적서 PDF 와 같은 규칙을 쓰도록 하는 단일 소스.
   */
  real_price: number;
}

/** 총견적서 계산 — 차량견적서 시트 수식 재현. */
export function calcQuote(p: QuoteParams): QuoteResult {
  // ── 차량 결제 금액 ──
  const partnership_discount = (p.car_price - p.commercial_discount) * p.partnership_rate; // D13
  const purchase_benefit = -(p.commercial_discount + partnership_discount);                // D14
  const subsidy_national = p.diesel_conversion ? p.subsidy_national - p.diesel_deduction : p.subsidy_national; // D15
  const subsidy_local = p.is_corporation || p.local_subsidy_off ? 0 : p.subsidy_local;      // D16
  const subsidy_sosang = p.is_sosang ? subsidy_national * p.sosang_rate : 0;               // D17
  const subsidy_takbae = p.is_individual && p.has_transport_license ? subsidy_national * p.takbae_rate : 0; // D18
  const subsidy_total = -(subsidy_national + subsidy_local + subsidy_sosang + subsidy_takbae); // D19
  const car_payment = p.car_price + p.delivery_fee + purchase_benefit + subsidy_total;     // D20

  // ── 특장 결제 금액 ──
  const body_payment = p.body_price - p.promotion;                                          // I20

  // ── 계약금·선수금·인도금 ──
  const down_payment = (car_payment + body_payment - p.car_deposit - p.body_deposit) * p.down_payment_rate; // D22
  const car_delivery = p.car_deposit + down_payment;                                        // D23 (선수금 전액 차량측)
  const body_delivery = p.body_deposit;                                                      // I23 (특장 선수금 0)

  // ── 취득세·등록/부대 ──
  const acqRate = p.has_biz_plate ? p.acq_tax_rate_biz : p.acq_tax_rate_normal;
  const car_acq_tax = floor10(((p.car_price + p.delivery_fee + purchase_benefit) / 11) * 10 * acqRate - p.acq_tax_relief); // D24
  const bond_discount = p.is_seoul_normal ? p.bond_discount : 0;                             // D25
  const car_reg_cost = car_acq_tax + bond_discount + p.plate + p.stamp + p.insurance + p.reg_agency; // D30
  const car_initial = car_delivery + car_reg_cost;                                           // D31

  const body_acq_tax = floor10(body_payment * p.special_acq_tax_rate);                       // I24
  const body_reg_cost = body_acq_tax + p.etc_fee + p.structure_change_fee;                   // I30
  const body_initial = body_delivery + body_reg_cost;                                        // I31

  // ── 할부 ──
  const car_installment = car_payment - car_delivery;                                        // L18
  const body_installment = body_payment - body_delivery;                                     // M18
  const total_installment = car_installment + body_installment;                              // L19
  const monthly_payment = pmt(p.installment_rate / 12, p.installment_months, total_installment); // M24
  const installment_interest = monthly_payment * p.installment_months - total_installment;    // M22
  // ── 부가세 환급 ──
  // ⚠️ 환급액은 **전기차 보조금을 빼기 전** 금액에서 구한다.
  //    보조금은 정부가 주는 돈이지 판매가를 깎은 것이 아니라, 세금계산서 금액이 줄지 않는다.
  //    (Ver1.21 엔진 calcPrice 도 같은 기준이다 — 공급가액 기준으로 vat 를 구해 뒤에 뺀다.
  //     예전 총견적서 재현판만 보조금 차감 후 금액에서 나눠 환급액이 작게 나왔다.)
  const vat_base = (p.car_price + p.delivery_fee + purchase_benefit) + body_payment;
  const vat_refund = floor10(vat_base / 11);
  const paid_total = car_payment + body_payment;   // 실제 결제금액(보조금 차감 후)

  // M26 부가세 환급 시 가격 — 일반구매자(비사업자)는 환급 불가 → 0원 표기
  const vat_refund_price = p.no_vat_refund ? 0 : paid_total - vat_refund;

  // 실구매가 = 실제 부담액 + 등록/부대비용.
  // 일반구매자는 환급을 못 받으므로 결제금액(VAT 포함) 그대로가 부담액이 된다.
  const paid = p.no_vat_refund ? paid_total : paid_total - vat_refund;
  const real_price = paid + car_reg_cost + body_reg_cost;

  return {
    car_price: p.car_price, delivery_fee: p.delivery_fee, commercial_discount: p.commercial_discount,
    partnership_discount, purchase_benefit,
    subsidy_national, subsidy_local, subsidy_sosang, subsidy_takbae, subsidy_total,
    car_payment, car_deposit: p.car_deposit, down_payment, car_delivery,
    car_acq_tax, bond_discount, plate: p.plate, stamp: p.stamp, insurance: p.insurance, reg_agency: p.reg_agency,
    car_reg_cost, car_initial,
    body_price: p.body_price, promotion: p.promotion, body_payment, body_deposit: p.body_deposit, body_delivery,
    body_acq_tax, etc_fee: p.etc_fee, structure_change_fee: p.structure_change_fee, body_reg_cost, body_initial,
    car_installment, body_installment, total_installment,
    installment_rate: p.installment_rate, installment_months: p.installment_months,
    monthly_payment, installment_interest, vat_refund_price, real_price,
  };
}
