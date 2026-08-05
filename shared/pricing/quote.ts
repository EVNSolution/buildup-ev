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
}

/** 총견적서 계산 — 차량견적서 시트 수식 재현. */
export function calcQuote(p: QuoteParams): QuoteResult {
  // ── 차량 결제 금액 ──
  const partnership_discount = (p.car_price - p.commercial_discount) * p.partnership_rate; // D13
  const purchase_benefit = -(p.commercial_discount + partnership_discount);                // D14
  const subsidy_national = p.diesel_conversion ? p.subsidy_national - p.diesel_deduction : p.subsidy_national; // D15
  const subsidy_local = p.is_corporation ? 0 : p.subsidy_local;                            // D16
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
  const body_reg_cost = body_acq_tax + p.etc_fee;                                            // I30
  const body_initial = body_delivery + body_reg_cost;                                        // I31

  // ── 할부 ──
  const car_installment = car_payment - car_delivery;                                        // L18
  const body_installment = body_payment - body_delivery;                                     // M18
  const total_installment = car_installment + body_installment;                              // L19
  const monthly_payment = pmt(p.installment_rate / 12, p.installment_months, total_installment); // M24
  const installment_interest = monthly_payment * p.installment_months - total_installment;    // M22
  const vat_refund_price = floor10(((car_payment + body_payment) / 11) * 10);                // M26

  return {
    car_price: p.car_price, delivery_fee: p.delivery_fee, commercial_discount: p.commercial_discount,
    partnership_discount, purchase_benefit,
    subsidy_national, subsidy_local, subsidy_sosang, subsidy_takbae, subsidy_total,
    car_payment, car_deposit: p.car_deposit, down_payment, car_delivery,
    car_acq_tax, bond_discount, plate: p.plate, stamp: p.stamp, insurance: p.insurance, reg_agency: p.reg_agency,
    car_reg_cost, car_initial,
    body_price: p.body_price, promotion: p.promotion, body_payment, body_deposit: p.body_deposit, body_delivery,
    body_acq_tax, etc_fee: p.etc_fee, body_reg_cost, body_initial,
    car_installment, body_installment, total_installment,
    installment_rate: p.installment_rate, installment_months: p.installment_months,
    monthly_payment, installment_interest, vat_refund_price,
  };
}
