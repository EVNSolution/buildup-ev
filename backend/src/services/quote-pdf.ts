/**
 * 견적서(총견적서) PDF 생성 — quoteId → PDF(Buffer).
 * 양식 = doc-templates/quote-template.html (레이아웃·스타일 고정, 값만 바인딩).
 *   바인딩 스펙 = doc-templates/quote-template_데이터계약.md, 시각정답지 = quote-sample-filled.html.
 * 계산 = calcQuote(총견적서). 라우트(GET /quotes/:id/pdf)·계약서 동봉이 공유.
 *
 * 치환: {{ token }} 스칼라 · <!-- each:NAME -->…<!-- /each:NAME --> 반복 · <!-- pad:COL --> 정렬빈행.
 * 표기 라벨(냉장/냉동·O/X 등)은 프레젠테이션 매핑(가격/값은 DB, CLAUDE.md 원칙 유지).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { calcQuote, optionBreakdown, toDieselStatus, DIESEL_STATUS_LABEL } from '@buildup-ev/shared/pricing';
import { buildQuoteParams, type CustomerInput } from './quote-calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(path.resolve(__dirname, '../../..', 'doc-templates/quote-template.html'), 'utf-8');

export class QuotePdfError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'DB_UNAVAILABLE' = 'NOT_FOUND') { super(message); }
}
export interface QuotePdfResult { pdf: Buffer; filename: string; customerName: string | null }

// ── 표기 매핑(프레젠테이션 전용) ──
const BODYTYPE_DISP: Record<string, string> = { BODY_REEFER: '냉장/냉동', BODY_DRY: '내장' };
const TOP_DISP: Record<string, string> = { TOP_LOW: '저상', TOP_STD: '표준' };
const DOOR_DISP: Record<string, string> = { DOOR_SWING: '여닫이', DOOR_SLIDE: '슬라이딩', DOOR_EVSLIDE: 'EV미닫이', DOOR_COUPANG: '미닫이', DOOR_FOLD: '양문미닫이' };
const PART_DISP: Record<string, string> = { PART_NET: '그물망', PART_REEFER: '냉장/냉동 이동식', PART_NONE: 'X' };
const BIZ_DISP: Record<string, string> = { individual: '개인사업자', corporation: '법인사업자', simplified: '간이과세자', consumer: '일반구매자' };
const ox = (on: boolean) => (on ? 'O' : 'X');

// ── 포맷 ──
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')} 원`;
const wonNeg = (n: number) => `(-) ${Math.round(Math.abs(n)).toLocaleString('ko-KR')} 원`;
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

/**
 * 반복 행 한 줄. **키를 label·amount 로 고정하지 않는다** — 프로모션 행처럼 다른 칸
 * (동그라미 번호 등)을 쓰는 반복도 있어서, 템플릿이 부르는 이름을 그대로 받는다.
 */
type Row = Record<string, string>;

// ── 미니 템플릿 엔진 ──
function renderEach(tpl: string, name: string, items: Row[]): string {
  const re = new RegExp(`<!-- each:${name} -->([\\s\\S]*?)<!-- /each:${name} -->`, 'g');
  return tpl.replace(re, (_m, inner: string) =>
    items.map((it) => inner.replace(/\{\{\s*item\.(\w+)\s*\}\}/g, (_x, k: string) => esc(it[k]))).join(''));
}
/** 세 열 콘텐츠 행수를 세서 부족분을 pad에 .blank 로 채워 final 행 정렬. */
function renderPad(tpl: string): string {
  const cols = ['car', 'top', 'cust'] as const;
  const count: Record<string, number> = {};
  for (const c of cols) {
    const idx = tpl.indexOf(`<!-- pad:${c} -->`);
    const tblStart = tpl.lastIndexOf('<table', idx);
    count[c] = (tpl.slice(tblStart, idx).match(/<tr/g) ?? []).length;
  }
  const max = Math.max(...cols.map((c) => count[c]!));
  let out = tpl;
  for (const c of cols) {
    const tds = c === 'cust' ? '<td>&nbsp;</td><td></td><td></td>' : '<td>&nbsp;</td><td></td>';
    const blanks = `<tr class="blank">${tds}</tr>`.repeat(max - count[c]!);
    out = out.replace(`<!-- pad:${c} -->`, blanks);
  }
  return out;
}
function renderTokens(tpl: string, data: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), data);
    return v == null ? '' : esc(String(v));
  });
}

export async function generateQuotePdf(quoteId: number): Promise<QuotePdfResult> {
  if (!prisma) throw new QuotePdfError('DB 연결 필요', 'DB_UNAVAILABLE');

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      customer: true,
      model: { select: { name: true } },
      sales_user: { select: { name: true, email: true } },
    },
  });
  if (!quote) throw new QuotePdfError('견적을 찾을 수 없습니다', 'NOT_FOUND');

  const selections = (quote.selections ?? {}) as Record<string, string>;
  const inp = (quote.inputs ?? {}) as Record<string, unknown>;
  const valueCodes = Object.values(selections).filter(Boolean);

  const [optionValues, optionPrices] = await Promise.all([
    prisma.optionValue.findMany({ where: { code: { in: valueCodes } } }),
    // ⚠️ value_code 로 좁히면 안 된다 — 단가는 **복합코드**(TOP_{body}_{top}, DOPT_/DADD_{body}_{top}_{door},
    //    SPL_{top}, PART_{top}_{kind})로 저장돼 있어 선택값 코드로 필터하면 전부 미스 → 개별 옵션이 0원이 된다.
    prisma.optionPrice.findMany({ where: { model_code: quote.model_code } }),
  ]);
  const valueName = new Map(optionValues.map((v) => [v.code, v.name]));
  const priceMap = new Map(optionPrices.map((p) => [p.value_code, p.supply_price]));

  // 총견적서 계산
  const customer: CustomerInput = {
    name: quote.customer?.name,
    biz_type: inp['biz_type'] as string | undefined,
    is_sosang: inp['is_sosang'] as boolean | undefined,
    region: inp['region'] as string | undefined,
    has_transport_license: inp['has_transport_license'] as boolean | undefined,
    diesel_status: inp['diesel_status'] as string | undefined,
    diesel_conversion: inp['diesel_conversion'] as boolean | undefined,
    has_biz_plate: inp['has_biz_plate'] as boolean | undefined,
    tax_exempt_type: inp['tax_exempt_type'] as string | undefined,
  };
  const params = await buildQuoteParams(quote.model_code, selections, customer, {
    down_payment_rate: inp['down_payment_rate'] as number | undefined,
    installment_months: inp['installment_months'] as number | undefined,
    promotion_zeroed: inp['promotion_zeroed'] as string[] | undefined,
    promotion_discount: inp['promotion_discount'] as number | undefined,
    // 특장만 견적 — 저장 시점의 선택을 그대로 따라야 금액이 재현된다
    body_only: inp['body_only'] === true,
    local_subsidy_off: inp['local_subsidy_off'] as boolean | undefined,
  }, quote.created_at.getFullYear());
  const r = calcQuote(params);

  // 특장옵션 행(라벨=표기매핑, 금액=옵션별 VAT포함)
  // 재량할인(프로모션)으로 0원 처리된 옵션은 견적서 개별 행도 0원으로 표기된다.
  const zeroed = (inp['promotion_zeroed'] as string[] | undefined) ?? [];
  const bd = optionBreakdown(selections, (c) => priceMap.get(c) ?? 0, zeroed);
  const vatInc = (supply: number) => Math.round(supply * 1.1);
  const bodyDisp = BODYTYPE_DISP[selections['BODYTYPE'] ?? ''] ?? '';
  const topDisp = TOP_DISP[selections['TOP'] ?? ''] ?? '';
  const doorDisp = DOOR_DISP[selections['DOORTYPE'] ?? ''] ?? '';
  const partDisp = PART_DISP[selections['PARTITION'] ?? ''] ?? '';
  const spoilerOn = selections['SPOILER'] === 'SPOILER_O';
  const doorAddOn = selections['DOORADD'] === 'ADD_DRIVER';
  const tempOn = selections['TEMP'] === 'TEMP_O';

  /**
   * 옵션 한 줄. **무상제공(0원 처리)된 것은 굵게** — 원래 값이 있는 옵션인데 0원으로
   * 찍혀 있으면 그냥 지나치기 쉽다. 안 고른 옵션(원래 0원)은 굵게 하지 않는다.
   */
  const topRow = (group: string, label: string): Row => ({
    label,
    amount: won(vatInc(bd[group] ?? 0)),
    cls: zeroed.includes(group) ? 'em' : '',
  });
  const topOptions: Row[] = [
    topRow('TOP', `탑 종류 : ${bodyDisp} ${topDisp}`.trim()),
    topRow('SPOILER', `스포일러 : ${ox(spoilerOn)}`),
    topRow('DOORTYPE', `도어옵션 : ${doorDisp}`),
    topRow('DOORADD', `도어추가 : ${ox(doorAddOn)}`),
    topRow('TEMP', `온도기록계 : ${ox(tempOn)}`),
    topRow('PARTITION', `격벽 : ${partDisp}`),
  ];
  /*
   * 프로모션 — **금액 할인이 있을 때만** 옵션 목록 맨 아래에 한 줄 붙인다(음수).
   * 무상제공(0원 처리)은 이 행을 만들지 않는다 — 옵션 단가가 이미 0원이라 이중으로 빼게 된다.
   * ⑦ 특장 가격이 이 줄까지 더한 값이라, 세로로 더해 보면 맞아떨어진다.
   */
  const promoAmount = Math.max(0, Math.round(r.promotion));
  if (promoAmount > 0) {
    topOptions.push({ label: '프로모션 :', amount: `-${won(promoAmount)}`, cls: 'em' });
  }

  const benefitRows: Row[] = [
    { label: '현대커머셜 할인', amount: won(r.commercial_discount) },
    { label: '공식 파트너십 할인', amount: won(r.partnership_discount) },
  ];

  const region = (inp['region'] as string | undefined) ?? '';
  const subsidyRows: Row[] = [];
  if (r.subsidy_national) subsidyRows.push({ label: '국고보조금 (정부)', amount: won(r.subsidy_national) });
  if (r.subsidy_local) subsidyRows.push({ label: `지방보조금 (${region})`, amount: won(r.subsidy_local) });
  if (r.subsidy_sosang) subsidyRows.push({ label: '소상공인 할인', amount: won(r.subsidy_sosang) });
  if (r.subsidy_takbae) subsidyRows.push({ label: '택배업 보조금 (화물운송자격)', amount: won(r.subsidy_takbae) });

  const trimName = valueName.get(selections['TRIM'] ?? '') ?? '';
  const bizType = (inp['biz_type'] as string | undefined) ?? 'individual';
  const downRate = (inp['down_payment_rate'] as number | undefined) ?? 0;

  const optionSummary = [
    `탑 종류 = ${bodyDisp}`, `탑 높이 = ${topDisp}`, `스포일러 = ${ox(spoilerOn)}`,
    `도어옵션 = ${doorDisp}`, `도어추가 = ${ox(doorAddOn)}`, `온도기록계 = ${ox(tempOn)}`, `격벽 = ${partDisp}`,
  ].join(' · ');

  // 차종명은 DB(vehicle_model.name) 기준 — 하드코딩 금지. 견적담당 = 계정 이름 + 이메일.
  const modelName = quote.model?.name ?? quote.model_code;
  const salesRep = quote.sales_user
    ? `${quote.sales_user.name} (${quote.sales_user.email})`
    : (quote.sales_user_id ?? '');



  const bodyOnly = inp['body_only'] === true;

  const data = {
    vehicleModel: modelName,
    workDate: quote.created_at.toISOString().slice(0, 10),
    salesRep,
    customerName: quote.customer?.name ?? '',
    modelSubtitle: `${modelName} : PV5 ${trimName} ${bodyDisp}탑차 – ${topDisp}`,
    optionSummary,
    // car 는 each 안에서 item.* 로 읽는다(아래 carSection). 여기 남겨 두면 토큰이 두 벌이 된다.
    carUnused: {
      price: won(r.car_price), deliveryFee: won(r.delivery_fee),
      benefitTotal: wonNeg(r.purchase_benefit), subsidyTotal: wonNeg(r.subsidy_total),
      paymentAmount: won(r.car_payment), downPayment: won(r.car_deposit), advancePayment: won(r.down_payment),
      deliveryPayment: won(r.car_delivery), acqTax: won(r.car_acq_tax), bondDiscount: won(r.bond_discount),
      plateFee: won(r.plate), stampFee: won(r.stamp), insuranceFee: won(r.insurance), regAgencyFee: won(r.reg_agency),
      regCost: won(r.car_reg_cost), initialPayment: won(r.car_initial),
    },
    top: {
      /*
       * ⑦ 특장 가격 — **프로모션 할인을 뺀 금액**(body_payment).
       * 프로모션 행이 위 옵션 목록에 −금액으로 들어가므로, 그 합이 곧 이 값이어야
       * 세로로 더해 봤을 때 맞는다. 할인이 없으면 body_price 와 같아 옛 견적은 그대로다.
       */
      priceTotal: won(r.body_payment),
      paymentAmount: won(r.body_payment), downPayment: won(r.body_deposit), deliveryPayment: won(r.body_delivery),
      acqTax: won(r.body_acq_tax), etcRegFee: won(r.etc_fee), structureFee: won(r.structure_change_fee), regCost: won(r.body_reg_cost), initialPayment: won(r.body_initial),
    },
    cust: {
      name: quote.customer?.name ?? '', bizType: BIZ_DISP[bizType] ?? bizType, region,
      isSosang: ox(!!inp['is_sosang']), hasTransportLicense: ox(!!inp['has_transport_license']),
      // 엑셀 '입력 시트' C5 선택지 문구 그대로(경유차없음 / 유지 / 폐차). 옛 견적은 boolean 으로 복원.
      dieselStatus: DIESEL_STATUS_LABEL[toDieselStatus(inp['diesel_status'], inp['diesel_conversion'])],
      hasCommercialPlate: ox(!!inp['has_biz_plate']), advanceRate: `${Math.round(downRate * 100)}%`,
      vatRefundPrice: won(r.vat_refund_price),
    },
    inst: {
      // 할부원금 = 총할부금. 차량·특장으로 나누지 않는다(양식에서 한 줄로 통합).
      total: won(r.total_installment),
      interestRate: `${(r.installment_rate * 100).toFixed(2)}%`,
      // 일시불(개월수 0)이면 PMT 가 0 이라 이자 = -원금 이 된다 — 0원으로 표기한다.
      interest: won(r.installment_months > 0 ? r.installment_interest : 0),
      termMonths: `${r.installment_months} 개월`,
      monthlyPayment: won(r.monthly_payment),
    },
    memoText: (inp['memo'] as string | undefined) ?? '',
    footerNote: '',
  };

  // 렌더: (설명주석 제거) → each → pad → tokens
  // ※ 템플릿 head 의 설명 주석에는 <!-- each:NAME --> 예시가 들어있어 그 '-->' 가 바깥 주석을
  //    조기 종료시킨다(HTML 주석 중첩 불가) → 본문에 설명문이 새어 나오므로 렌더 전 통째로 제거.
  let html = TEMPLATE.replace(/<!--\s*\n\s*STEGO-K1 견적서 양식[\s\S]*?\n-->/, '');
  html = renderEach(html, 'benefitRows', benefitRows);
  html = renderEach(html, 'subsidyRows', subsidyRows);
  html = renderEach(html, 'topOptions', topOptions);

  /*
   * 차량 칸은 두 갈래다 — 차를 파는 견적이면 금액 표, 특장만이면 「고객 보유 차량」.
   *
   * ⚠️ **순서가 중요하다.** benefitRows·subsidyRows 는 carSection **안에** 있다.
   *    바깥을 먼저 펼치면 `{{ item.label }}` 같은 안쪽 토큰까지 바깥 item 으로 먹어 버려
   *    할인·보조금 줄이 빈칸이 된다. 안쪽을 먼저 펼친 뒤 바깥을 편다.
   *    renderPad 보다도 앞이어야 한다 — 두 갈래에 `pad:car` 가 하나씩 있어,
   *    갈래를 먼저 정리하지 않으면 엉뚱한 쪽을 채운다.
   */
  const owned = (inp['vehicle_owned'] ?? {}) as Record<string, string>;
  html = renderEach(html, 'carSection', bodyOnly ? [] : [{
    price: won(r.car_price), deliveryFee: won(r.delivery_fee),
    benefitTotal: wonNeg(r.purchase_benefit), subsidyTotal: wonNeg(r.subsidy_total),
    paymentAmount: won(r.car_payment), downPayment: won(r.car_deposit), advancePayment: won(r.down_payment),
    deliveryPayment: won(r.car_delivery), acqTax: won(r.car_acq_tax), bondDiscount: won(r.bond_discount),
    plateFee: won(r.plate), stampFee: won(r.stamp), insuranceFee: won(r.insurance), regAgencyFee: won(r.reg_agency),
    regCost: won(r.car_reg_cost), initialPayment: won(r.car_initial),
  }]);
  html = renderEach(html, 'ownedSection', bodyOnly ? [{
    carName: owned['car_name'] ?? '—',
    typeName: owned['type_name'] ?? '—',
    plateNo: owned['plate_no'] ?? '—',
    vin: owned['vin'] ?? '—',
  }] : []);

  html = renderPad(html);
  html = renderTokens(html, data);

  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    // @ts-expect-error puppeteer 타입이 setContent 의 'networkidle0' 을 좁게 잡음(런타임 지원 — 웹폰트 로드 대기)
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true }));
    const customerSlug = (quote.customer?.name ?? '').replace(/\s+/g, '_') || 'unknown';
    return { pdf, filename: `견적서_${customerSlug}_${quoteId}.pdf`, customerName: quote.customer?.name ?? null };
  } finally {
    await browser.close();
  }
}
