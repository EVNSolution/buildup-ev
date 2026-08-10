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

interface Row { label: string; amount: string }

// ── 미니 템플릿 엔진 ──
function renderEach(tpl: string, name: string, items: Row[]): string {
  const re = new RegExp(`<!-- each:${name} -->([\\s\\S]*?)<!-- /each:${name} -->`, 'g');
  return tpl.replace(re, (_m, inner: string) =>
    items.map((it) => inner.replace(/\{\{\s*item\.(\w+)\s*\}\}/g, (_x, k: string) => esc((it as Record<string, unknown>)[k]))).join(''));
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

  const topOptions: Row[] = [
    { label: `탑 종류 : ${bodyDisp} ${topDisp}`.trim(), amount: won(vatInc(bd['TOP'] ?? 0)) },
    { label: `스포일러 : ${ox(spoilerOn)}`, amount: won(vatInc(bd['SPOILER'] ?? 0)) },
    { label: `도어옵션 : ${doorDisp}`, amount: won(vatInc(bd['DOORTYPE'] ?? 0)) },
    { label: `도어추가 : ${ox(doorAddOn)}`, amount: won(vatInc(bd['DOORADD'] ?? 0)) },
    { label: `온도기록계 : ${ox(tempOn)}`, amount: won(vatInc(bd['TEMP'] ?? 0)) },
    { label: `격벽 : ${partDisp}`, amount: won(vatInc(bd['PARTITION'] ?? 0)) },
  ];

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

  const data = {
    vehicleModel: modelName,
    workDate: quote.created_at.toISOString().slice(0, 10),
    salesRep,
    customerName: quote.customer?.name ?? '',
    modelSubtitle: `${modelName} : PV5 ${trimName} ${bodyDisp}탑차 – ${topDisp}`,
    optionSummary,
    car: {
      price: won(r.car_price), deliveryFee: won(r.delivery_fee),
      benefitTotal: wonNeg(r.purchase_benefit), subsidyTotal: wonNeg(r.subsidy_total),
      paymentAmount: won(r.car_payment), downPayment: won(r.car_deposit), advancePayment: won(r.down_payment),
      deliveryPayment: won(r.car_delivery), acqTax: won(r.car_acq_tax), bondDiscount: won(r.bond_discount),
      plateFee: won(r.plate), stampFee: won(r.stamp), insuranceFee: won(r.insurance), regAgencyFee: won(r.reg_agency),
      regCost: won(r.car_reg_cost), initialPayment: won(r.car_initial),
    },
    top: {
      priceTotal: won(r.body_price), promoAmount: won(r.promotion), promoTotal: won(r.promotion),
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
      car: won(r.car_installment), top: won(r.body_installment), total: won(r.total_installment),
      productName: '일반형 오토론할부',
      interestRate: `${(r.installment_rate * 100).toFixed(2)}%`,
      interest: won(r.installment_interest), termMonths: `${r.installment_months} 개월`,
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
