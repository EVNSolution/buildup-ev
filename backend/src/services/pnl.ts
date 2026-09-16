/**
 * **차량 판매건별 손익** — 경영관리가 월 단위로 적고 보는 표(2026-09-16 지시).
 *
 * 달을 가르는 기준은 **세금계산서 발행일**이다. 발행일을 적는 순간 그 달 표로 들어간다.
 * 아직 안 적은 건은 「입력 필요」에 모여 있다가, 적으면 사라진다.
 *
 * ⚠️ **처음 만들 때 계약 금액을 굳힌다.** 공급가액·계약금은 계약서에서 가져와 채우되,
 *    그 뒤로는 적힌 값이 정본이다. 단가표를 나중에 고쳤다고 이미 세금계산서가 나간 줄의
 *    금액이 소급해 바뀌면 안 된다 — 발주서 금액을 얼려 두는 것과 같은 이유다.
 */
import { prisma } from '../lib/prisma.js';
import { calcQuote } from '@buildup-ev/shared/pricing';
import { monthBounds, supplyFromGross } from '@buildup-ev/shared/finance/pnl';
import { buildQuoteParams, quoteExtraFromInputs, type CustomerInput } from './quote-calc.js';
import { VISIBLE } from '../lib/visibility.js';

/** 손익 줄 하나 — 화면이 읽는 모양. 금액은 **수(number)** 로 내려보낸다(BigInt 는 JSON 이 못 싣는다) */
export interface PnlRow {
  quote_id: number;
  quote_no: string | null;
  customer: string | null;
  biz_name: string | null;
  sales_user_id: string | null;
  maker_org: string | null;
  invoice_on: string | null;
  supply_amount: number;
  deposit: number;
  capital: number;
  deposit_paid_on: string | null;
  capital_paid_on: string | null;
  cost_outsourcing: number;
  cost_supply: number;
  cost_internal: number;
  cost_etc: number;
  cost_source: string;
  cost_memo: string | null;
  memo: string | null;
  updated_by: string | null;
}

/** 아직 세금계산서 발행일을 안 적은 건 — 화면 맨 위 「입력 필요」 */
export interface PnlPending {
  quote_id: number;
  quote_no: string | null;
  customer: string | null;
  contracted_on: string | null;
  /** 계약서에서 가져온 공급가액(VAT 별도) — 저장 전 미리보기 */
  supply_default: number | null;
  deposit_default: number;
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);
const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** DB 행 + 견적을 화면 모양으로 */
type RowWithQuote = {
  quote_id: number; invoice_on: Date | null; biz_name: string | null;
  supply_amount: bigint; deposit: bigint; capital: bigint;
  deposit_paid_on: Date | null; capital_paid_on: Date | null;
  cost_outsourcing: bigint; cost_supply: bigint; cost_internal: bigint; cost_etc: bigint;
  cost_source: string; cost_memo: string | null; memo: string | null; updated_by: string | null;
  quote: {
    quote_no: string | null; sales_user_id: string | null;
    customer: { name: string } | null;
    order: { maker_org: { name: string } | null } | null;
  };
};

function toRow(r: RowWithQuote): PnlRow {
  return {
    quote_id: r.quote_id,
    quote_no: r.quote.quote_no,
    customer: r.quote.customer?.name ?? null,
    biz_name: r.biz_name,
    sales_user_id: r.quote.sales_user_id,
    maker_org: r.quote.order?.maker_org?.name ?? null,
    invoice_on: day(r.invoice_on),
    supply_amount: n(r.supply_amount),
    deposit: n(r.deposit),
    capital: n(r.capital),
    deposit_paid_on: day(r.deposit_paid_on),
    capital_paid_on: day(r.capital_paid_on),
    cost_outsourcing: n(r.cost_outsourcing),
    cost_supply: n(r.cost_supply),
    cost_internal: n(r.cost_internal),
    cost_etc: n(r.cost_etc),
    cost_source: r.cost_source,
    cost_memo: r.cost_memo,
    memo: r.memo,
    updated_by: r.updated_by,
  };
}

const QUOTE_PICK = {
  quote_no: true, sales_user_id: true,
  customer: { select: { name: true } },
  order: { select: { maker_org: { select: { name: true } } } },
} as const;

/** 그 달에 세금계산서가 나간 줄들 */
export async function pnlOfMonth(ym: string): Promise<PnlRow[]> {
  if (!prisma) return [];
  const { from, to } = monthBounds(ym);
  const rows = await prisma.orderPnl.findMany({
    where: { invoice_on: { gte: new Date(from), lt: new Date(to) } },
    orderBy: [{ invoice_on: 'asc' }, { quote_id: 'asc' }],
    include: { quote: { select: QUOTE_PICK } },
  });
  return rows.map(r => toRow(r as unknown as RowWithQuote));
}

/**
 * 계약서에서 가져오는 처음 값 — **특장 결제금액**에서 공급가액(VAT 별도)과 계약금을 뽑는다.
 *
 * `body_payment` 는 VAT 포함이라 1.1 로 나눠 공급가액을 낸다. 계약금은 특장 계약금 그대로다.
 * 계산에 실패하면(옛 견적·단가 누락) **null 을 돌려준다** — 0 으로 채우면 「0원짜리 판매」가 된다.
 */
export async function contractDefaults(quoteId: number): Promise<{ supply: number | null; deposit: number; biz_name: string | null }> {
  if (!prisma) return { supply: null, deposit: 0, biz_name: null };
  /*
   * ⚠️ **여기서 던지면 손익 화면 전체가 안 뜬다.** 「입력 필요」는 수십 줄을 한 번에 세는데,
   *    그 중 한 건이 옛 견적·단가 누락으로 못 세는 일이 실제로 있다. 한 줄을 못 세면 그 줄만
   *    비워 두고 손으로 적게 한다 — 나머지 줄까지 같이 잃지 않는다.
   */
  const q = await prisma.quote.findUnique({ where: { id: quoteId }, include: { customer: true } }).catch(() => null);
  if (!q) return { supply: null, deposit: 0, biz_name: null };
  const inp = (q.inputs ?? {}) as Record<string, unknown>;
  const customer: CustomerInput = {
    name: q.customer?.name,
    biz_type: inp['biz_type'] as string | undefined,
    is_sosang: inp['is_sosang'] as boolean | undefined,
    region: inp['region'] as string | undefined,
    has_transport_license: inp['has_transport_license'] as boolean | undefined,
    diesel_status: inp['diesel_status'] as string | undefined,
    has_biz_plate: inp['has_biz_plate'] as boolean | undefined,
    tax_exempt_type: inp['tax_exempt_type'] as string | undefined,
  };
  /** 계약서에 적힌 상호 — 없으면 고객명으로 시작한다(경영관리가 고친다) */
  const bizName = (inp['contract_party'] as string | undefined)?.trim() || q.customer?.name || null;
  try {
    // 보조금·세율은 **견적을 만든 해** 기준이다 — 올해 표로 다시 세면 작년 계약 금액이 바뀐다
    const calcYear = q.created_at.getFullYear();
    const params = await buildQuoteParams(
      q.model_code, (q.selections ?? {}) as Record<string, string>, customer, quoteExtraFromInputs(inp), calcYear,
    );
    const total = calcQuote(params);
    // 특장 결제금액(VAT 포함) → 공급가액(VAT 별도). 그냥 나누면 VAT 버림 때문에 1원이 샌다
    const supply = total.body_payment > 0 ? supplyFromGross(total.body_payment) : null;
    return { supply, deposit: Math.max(0, Math.round(total.body_deposit || 0)), biz_name: bizName };
  } catch {
    // 옛 견적·단가 누락으로 다시 셀 수 없는 건이 있다. 그럴 땐 손으로 적게 둔다
    return { supply: null, deposit: 0, biz_name: bizName };
  }
}

/** 값을 다시 셀 만큼만 — 「입력 필요」가 수백 줄이면 계산을 건너뛴다(그때는 손으로 적는다) */
const DEFAULTS_LIMIT = 60;

/**
 * 아직 발행일을 안 적은 건 — **계약 완료 이상**이면서 손익 줄이 없거나 발행일이 빈 것.
 * 오래된 것부터 위에 둔다(먼저 처리할 순서).
 */
export async function pnlPending(): Promise<PnlPending[]> {
  if (!prisma) return [];
  const quotes = await prisma.quote.findMany({
    where: {
      ...VISIBLE,
      status: { in: ['contracted', 'assigned', 'ordered', 'completed'] },
      OR: [{ pnl: { is: null } }, { pnl: { invoice_on: null } }],
    },
    select: {
      id: true, quote_no: true, created_at: true,
      customer: { select: { name: true } },
      contracts: { orderBy: { created_at: 'desc' }, take: 1, select: { completed_at: true } },
      pnl: { select: { biz_name: true, supply_amount: true, deposit: true } },
    },
    orderBy: { created_at: 'asc' },
  });

  const out: PnlPending[] = [];
  for (const q of quotes) {
    const kept = q.pnl;
    let supply: number | null = kept ? n(kept.supply_amount) : null;
    let deposit = kept ? n(kept.deposit) : 0;
    // 이미 적어 둔 줄이 있으면 그 값을 쓴다 — 다시 세지 않는다(굳힌 값이 정본이다)
    if (!kept && out.length < DEFAULTS_LIMIT) {
      const d = await contractDefaults(q.id);
      supply = d.supply; deposit = d.deposit;
    }
    out.push({
      quote_id: q.id,
      quote_no: q.quote_no,
      customer: q.customer?.name ?? null,
      contracted_on: day(q.contracts[0]?.completed_at ?? null) ?? day(q.created_at),
      supply_default: supply,
      deposit_default: deposit,
    });
  }
  return out;
}

/** 화면이 보낸 값 — 안 보낸 칸은 그대로 둔다(부분 저장) */
export interface PnlPatch {
  invoice_on?: string | null;
  biz_name?: string | null;
  supply_amount?: number;
  deposit?: number;
  capital?: number;
  deposit_paid_on?: string | null;
  capital_paid_on?: string | null;
  cost_outsourcing?: number;
  cost_supply?: number;
  cost_internal?: number;
  cost_etc?: number;
  cost_memo?: string | null;
  memo?: string | null;
}

const money = (v: unknown): bigint | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? BigInt(Math.max(0, Math.round(v))) : undefined;
const dateOf = (v: unknown): Date | null | undefined => {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const text = (v: unknown, max: number): string | null | undefined => {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  return v.trim().slice(0, max) || null;
};

/**
 * 줄 하나를 적는다(없으면 만든다).
 *
 * 처음 만들 때만 계약서에서 공급가액·계약금·사업자명을 채운다 — 화면이 값을 함께 보냈으면 그 값이 이긴다.
 */
export async function savePnl(quoteId: number, patch: PnlPatch, by: string): Promise<PnlRow | null> {
  if (!prisma) return null;
  const exists = await prisma.orderPnl.findUnique({ where: { quote_id: quoteId }, select: { id: true } });

  const data: Record<string, unknown> = { updated_by: by };
  const put = (key: string, v: unknown) => { if (v !== undefined) data[key] = v; };
  put('invoice_on', dateOf(patch.invoice_on));
  put('biz_name', text(patch.biz_name, 120));
  put('supply_amount', money(patch.supply_amount));
  put('deposit', money(patch.deposit));
  put('capital', money(patch.capital));
  put('deposit_paid_on', dateOf(patch.deposit_paid_on));
  put('capital_paid_on', dateOf(patch.capital_paid_on));
  put('cost_outsourcing', money(patch.cost_outsourcing));
  put('cost_supply', money(patch.cost_supply));
  put('cost_internal', money(patch.cost_internal));
  put('cost_etc', money(patch.cost_etc));
  put('cost_memo', text(patch.cost_memo, 500));
  put('memo', text(patch.memo, 500));

  if (!exists) {
    const d = await contractDefaults(quoteId);
    if (data['supply_amount'] === undefined && d.supply !== null) data['supply_amount'] = BigInt(d.supply);
    if (data['deposit'] === undefined) data['deposit'] = BigInt(d.deposit);
    if (data['biz_name'] === undefined && d.biz_name) data['biz_name'] = d.biz_name;
    await prisma.orderPnl.create({ data: { quote_id: quoteId, ...data } as never });
  } else {
    await prisma.orderPnl.update({ where: { quote_id: quoteId }, data: data as never });
  }

  const saved = await prisma.orderPnl.findUnique({
    where: { quote_id: quoteId },
    include: { quote: { select: QUOTE_PICK } },
  });
  return saved ? toRow(saved as unknown as RowWithQuote) : null;
}

/** 줄이 있는 달들 — 화면의 달 고르개가 「있는 달」만 보여 준다 */
export async function pnlMonths(): Promise<string[]> {
  if (!prisma) return [];
  const rows = await prisma.orderPnl.findMany({
    where: { invoice_on: { not: null } },
    select: { invoice_on: true },
    orderBy: { invoice_on: 'desc' },
  });
  return [...new Set(rows.map(r => day(r.invoice_on)!.slice(0, 7)))];
}
