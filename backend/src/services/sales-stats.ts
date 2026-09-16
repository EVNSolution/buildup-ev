/**
 * 영업 성과 집계 — 계정별 깔때기·금액·활동량·속도, 그리고 「지금 붙어야 할 건」.
 *
 * 무엇을 세느냐보다 **무엇을 보고 움직일 수 있느냐**로 골랐다.
 *   깔때기 = 어디서 새는지 (사람마다 처방이 다르다)
 *   금액   = 건수만 보면 소액 견적을 많이 낸 쪽이 유리해진다
 *   누수   = 오늘 당장 전화할 목록 — 성과 측정보다 이쪽이 매출에 가깝다
 *
 * ── 세는 규칙(2026-09-16 전면 재정비) ────────────────────────────────────────
 *
 * ① **지금 상태로 센다.** 예전에는 「한 번이라도 그 단계를 밟았는가」로 셌다. 그래서
 *    **배정을 취소해 계약완료로 되돌린 건이 배정완료에 그대로 남았다**(제보). 되돌리는
 *    길은 넷이다 — 배정 취소 · 배정 거부 · 특장사 거부 · 주문 삭제. 하나씩 예외를 두면
 *    다음에 생기는 길에서 또 샌다. 그래서 **견적의 현재 상태**만 본다. 되돌리면 그 자리에서 빠진다.
 *
 * ② **고객 수(명)와 건수(건)를 따로 낸다.** 한 고객에게 견적을 다섯 번 고쳐 내보내면
 *    건수는 5이지만 상담한 고객은 한 명이다. 임시저장은 활동량이라 건수로 두고,
 *    견적완료부터는 **고객 수**를 함께 낸다. 같은 사람인지는 서류함과 **같은 규칙**
 *    (이름+생년월일 / 이름+휴대폰)으로 본다 — 두 화면의 고객 수가 갈리면 안 된다.
 *
 * ③ **기간은 「그 단계에 도달한 날」로 가른다.** 예전에는 견적을 만든 날로 걸러서,
 *    8월에 만들어 9월에 계약한 건이 「9월 계약」에 잡히지 않았다. 「이번 달 계약」은
 *    이번 달에 계약된 건이어야 한다. 도달 시각을 모르는 옛 건은 **세지 않는다** —
 *    없는 시간을 지어내지 않는다(기간을 안 주면 전부 센다).
 *
 * ⚠️ 전이 시각은 quote_change_log(section='status')에 쌓인다. 그 기록을 남기기 전에
 *    진행된 견적은 곁에 있는 시각으로 메운다(계약완료=서명완료, 배정=주문배정).
 */
import { prisma } from '../lib/prisma.js';
import { VISIBLE } from '../lib/visibility.js';
import { groupCustomers, type FolderCustomer } from './customer-folders.js';
import { STATUS_SECTION, stageTimesOf } from './quote-status.js';

const DAY = 24 * 60 * 60 * 1000;

/** 깔때기 단계 — 화면 표기와 같은 순서 */
export const FUNNEL = ['draft', 'confirmed', 'contracted', 'assigned', 'ordered', 'completed'] as const;
export type FunnelStage = (typeof FUNNEL)[number];

export interface SalesStat {
  sales_user_id: string;
  /**
   * 단계별 **건수** — 견적의 **현재 상태**가 그 단계 이상인 것.
   * 되돌린 건(배정 취소·거부·주문 삭제)은 그 자리에서 빠진다.
   */
  reached: Record<FunnelStage, number>;
  /**
   * 단계별 **고객 수** — 같은 조건을 고객으로 묶어 센다(한 고객에게 여러 건이어도 1명).
   * `customers.draft` 가 「상담고객」 = 견적이 나간 고객 수다.
   */
  customers: Record<FunnelStage, number>;
  /**
   * 금액 — 견적완료는 **고객당 가장 최근 견적 한 건**만 더한다(같은 차를 세 번 견적내면 세 배가 된다).
   * 계약·인도는 건마다 따로 된 거래라 그대로 더한다.
   */
  amount: { confirmed: number; contracted: number; completed: number };
  /** 활동량 — 기간 안에 **실제로 한 일**(만든 견적·보낸 메일·요청한 서명·고친 횟수) */
  activity: { quotes: number; emailed: number; sign_requested: number; edits: number };
  /** 평균 소요일 — 계산 가능한 건만(표본 수를 함께 준다) */
  lead: {
    to_confirmed: { days: number | null; n: number };
    to_contracted: { days: number | null; n: number };
    to_completed: { days: number | null; n: number };
  };
  /** 서명 방식별 완료율 */
  signing: { email_sent: number; email_done: number; kakao_sent: number; kakao_done: number };
  /** 견적당 평균 수정 횟수 — 높으면 초기 상담에서 조건을 덜 받은 것 */
  edits_per_quote: number | null;
}

export interface StatsRange { from?: Date; to?: Date; salesUser?: string }

/** 평균(일). 표본이 없으면 null — 0 으로 두면 '빠르다'로 잘못 읽힌다. */
function avgDays(list: number[]): { days: number | null; n: number } {
  if (!list.length) return { days: null, n: 0 };
  return { days: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10, n: list.length };
}

const zeroStages = (): Record<FunnelStage, number> =>
  ({ draft: 0, confirmed: 0, contracted: 0, assigned: 0, ordered: 0, completed: 0 });

function blankStat(user: string): SalesStat {
  return {
    sales_user_id: user,
    reached: zeroStages(),
    customers: zeroStages(),
    amount: { confirmed: 0, contracted: 0, completed: 0 },
    activity: { quotes: 0, emailed: 0, sign_requested: 0, edits: 0 },
    lead: { to_confirmed: { days: null, n: 0 }, to_contracted: { days: null, n: 0 }, to_completed: { days: null, n: 0 } },
    signing: { email_sent: 0, email_done: 0, kakao_sent: 0, kakao_done: 0 },
    edits_per_quote: null,
  };
}

/** 계정 한 벌 — 고객 중복을 걸러야 해서 집계 중에는 Set·Map 을 곁에 든다 */
interface Acc {
  stat: SalesStat;
  lead: { c: number[]; k: number[]; d: number[] };
  seen: Record<FunnelStage, Set<string>>;
  /** 견적완료 금액 — 고객 열쇠별 **가장 최근 견적** 한 건 */
  confirmAmt: Map<string, { price: number; at: number }>;
}

const blank = (user: string): Acc => ({
  stat: blankStat(user),
  lead: { c: [], k: [], d: [] },
  seen: { draft: new Set(), confirmed: new Set(), contracted: new Set(), assigned: new Set(), ordered: new Set(), completed: new Set() },
  confirmAmt: new Map(),
});

/** 모은 것을 화면이 읽는 모양으로 굳힌다 — 고객 수·견적완료 금액은 여기서 비로소 정해진다 */
function seal({ stat, lead, seen, confirmAmt }: Acc): SalesStat {
  for (const stage of FUNNEL) stat.customers[stage] = seen[stage].size;
  stat.amount.confirmed = [...confirmAmt.values()].reduce((a, b) => a + b.price, 0);
  stat.lead = {
    to_confirmed: avgDays(lead.c),
    to_contracted: avgDays(lead.k),
    to_completed: avgDays(lead.d),
  };
  stat.edits_per_quote = stat.activity.quotes ? Math.round((stat.activity.edits / stat.activity.quotes) * 10) / 10 : null;
  return stat;
}

/** 계정별 한 줄씩. 합계가 필요하면 `salesStatsFull` 을 쓴다 */
export async function salesStats(range: StatsRange): Promise<SalesStat[]> {
  return (await salesStatsFull(range)).rows;
}

/** 전체 합계를 쓰는 이름 — 화면에 「전체 집계」로 나간다 */
export const TOTAL_ROW = '(전체)';

/**
 * 계정별 + **전체 합계**.
 *
 * ⚠️ 합계를 화면에서 더해서 만들면 안 된다 — **고객 수는 더할 수 없다.**
 *    한 고객을 두 영업이 나눠 맡으면 각자 1명이라 합이 2명이 된다.
 *    그래서 합계도 같은 자리에서 **고객 열쇠로 다시 묶어** 낸다.
 */
export async function salesStatsFull(range: StatsRange): Promise<{ rows: SalesStat[]; total: SalesStat }> {
  if (!prisma) return { rows: [], total: blankStat(TOTAL_ROW) };

  // 숨긴 견적은 성과에서 뺀다 — 안 쓰기로 한 견적이 퍼널에 계속 잡히면 숫자를 못 믿는다
  const where: Record<string, unknown> = { ...VISIBLE };
  if (range.salesUser) where['sales_user_id'] = range.salesUser;
  // 만들기 전에는 어떤 단계에도 닿을 수 없다 — 끝 날짜 뒤에 만든 견적은 볼 것도 없다
  if (range.to) where['created_at'] = { lte: range.to };

  const quotes = await prisma.quote.findMany({
    where,
    select: {
      id: true, customer_id: true, sales_user_id: true, status: true, final_price: true,
      created_at: true, updated_at: true, docs_emailed_at: true,
      contracts: { select: { status: true, sent_at: true, completed_at: true, signing_method: true } },
      order: { select: { assigned_at: true } },
      change_logs: { select: { section: true, new_value: true, changed_at: true } },
    },
  });

  /*
   * 같은 사람 묶기 — **서류함과 같은 규칙**(이름+생년월일 / 이름+휴대폰)을 그대로 쓴다.
   * 숨긴 고객 행도 묶음에 넣는다. 빼면 그 행에 달린 견적이 다른 사람으로 세어져
   * 고객 수가 도로 부풀려진다.
   */
  const custIds = [...new Set(quotes.map(q => q.customer_id).filter((v): v is number => v !== null))];
  const folderOf = new Map<number, number>();
  if (custIds.length > 0) {
    const rows = await prisma.customer.findMany({
      where: { id: { in: custIds } },
      select: { id: true, name: true, reg_no: true, phone: true, updated_at: true },
    });
    for (const g of groupCustomers(rows as FolderCustomer[])) for (const id of g.ids) folderOf.set(id, g.key);
  }
  /**
   * 고객 열쇠 — 금액을 고객당 한 건으로 줄일 때 쓴다.
   * 고객이 안 붙은 견적은 묶을 근거가 없어 각자 한 건으로 둔다(**고객 수에는 넣지 않는다**).
   */
  const keyOf = (q: { id: number; customer_id: number | null }) =>
    q.customer_id === null ? `q${q.id}` : `c${folderOf.get(q.customer_id) ?? q.customer_id}`;
  /** 고객 수에 넣을 열쇠 — **고객 정보가 붙은 견적만.** 이름도 없는 임시저장은 만난 사람이 아니다 */
  const personOf = (q: { customer_id: number | null }) =>
    q.customer_id === null ? null : `c${folderOf.get(q.customer_id) ?? q.customer_id}`;

  /** 기간 안에 일어난 일인가. 기간을 안 주면 전부 센다 */
  const noRange = !range.from && !range.to;
  const inRange = (at: Date | null | undefined): boolean => {
    if (noRange) return true;
    if (!at) return false;
    if (range.from && at < range.from) return false;
    if (range.to && at > range.to) return false;
    return true;
  };
  /**
   * 끝이 **열려 있는** 기간인가(오늘까지) — 「이번 달」이 그렇다.
   * 열려 있으면, 기간 안에 만든 견적이 지금 어느 단계든 **그 단계도 기간 안**에서 일어난 것이다
   * (견적을 만들기 전에는 계약할 수 없고, 오늘 이후는 아직 오지 않았다).
   */
  const openEnd = !range.to || range.to.getTime() >= Date.now();
  /**
   * 그 단계에 도달한 **날짜**. 전이 이력을 남기기 전에 진행된 옛 건은 기록이 없다 —
   * 끝이 열린 기간에서는 **만든 날**로 갈음한다. 그러지 않으면 상태는 「계약완료」인데
   * 이번 달 계약이 한 건도 없는 것처럼 보인다(실제 데이터에서 78건이 그렇게 사라졌다).
   * 지난 달을 따로 볼 때는(끝이 닫힌 기간) 갈음하지 않는다 — 없는 시간을 지어내지 않는다.
   */
  const whenOf = (at: Date | null, created: Date): Date | null => at ?? (openEnd ? created : null);

  const byUser = new Map<string, Acc>();
  const totalAcc = blank(TOTAL_ROW);

  for (const q of quotes) {
    const user = q.sales_user_id ?? '(미지정)';
    if (!byUser.has(user)) byUser.set(user, blank(user));
    const accs = [byUser.get(user)!, totalAcc];

    const statusLogs = q.change_logs.filter((l) => l.section === STATUS_SECTION);
    const latestContract = q.contracts[0];
    const at = stageTimesOf(q, statusLogs, {
      contracted: latestContract?.completed_at ?? null,
      assigned: q.order?.assigned_at ?? null,
    });

    const key = keyOf(q);
    const person = personOf(q);
    const price = q.final_price ?? 0;
    /** 지금 어느 단계인가. 만료·취소(expired)는 깔때기 밖이라 -1 이 된다 */
    const idxNow = (FUNNEL as readonly string[]).indexOf(q.status);
    /** 그 단계를 지금도 지나와 있고, 그 단계에 도달한 날이 기간 안인가 */
    const counted = (stage: FunnelStage, i: number) =>
      // 임시저장은 「만든 것」 자체다 — 만료된 견적도 만들기는 했다
      (i === 0 || idxNow >= i) && inRange(whenOf(at[stage], q.created_at));

    const edits = q.change_logs.filter((l) => l.section !== STATUS_SECTION && inRange(l.changed_at)).length;
    const signRequested = q.contracts.some((c) => c.sent_at && inRange(c.sent_at));

    // 계정 한 줄과 전체 합계에 **같은 셈**을 넣는다 — 합계를 따로 더하면 고객 수가 어긋난다
    for (const acc of accs) {
      const st = acc.stat;
      FUNNEL.forEach((stage, i) => {
        if (!counted(stage, i)) return;
        st.reached[stage] += 1;
        if (person) acc.seen[stage].add(person);
      });

      if (counted('confirmed', 1)) {
        // 같은 고객이면 가장 최근에 손댄 견적 한 건만 — 견적을 고쳐 다시 낼수록 늘어나면 안 된다
        const prev = acc.confirmAmt.get(key);
        const mine = q.updated_at.getTime();
        if (!prev || mine > prev.at) acc.confirmAmt.set(key, { price, at: mine });
      }
      if (counted('contracted', 2)) st.amount.contracted += price;
      if (counted('completed', 5)) st.amount.completed += price;

      if (inRange(q.created_at)) st.activity.quotes += 1;
      if (q.docs_emailed_at && inRange(q.docs_emailed_at)) st.activity.emailed += 1;
      if (signRequested) st.activity.sign_requested += 1;
      st.activity.edits += edits;

      for (const c of q.contracts) {
        if (!c.sent_at || !inRange(c.sent_at)) continue;
        const kakao = c.signing_method === 'KAKAO';
        if (kakao) st.signing.kakao_sent += 1; else st.signing.email_sent += 1;
        if (c.status === 'COMPLETED') { if (kakao) st.signing.kakao_done += 1; else st.signing.email_done += 1; }
      }

      // 소요일 — 그 단계를 이번에 센 건만. 「이번 달 계약된 건은 평균 며칠 걸렸나」
      if (counted('confirmed', 1) && at.confirmed) acc.lead.c.push((at.confirmed.getTime() - at.draft.getTime()) / DAY);
      if (counted('contracted', 2) && at.contracted) acc.lead.k.push((at.contracted.getTime() - at.draft.getTime()) / DAY);
      if (counted('completed', 5) && at.completed) acc.lead.d.push((at.completed.getTime() - at.draft.getTime()) / DAY);
    }
  }

  return { rows: [...byUser.values()].map(seal), total: seal(totalAcc) };
}

// ── 지금 붙어야 할 건 ───────────────────────────────────────────────────────

export type AttentionKind = 'sign_pending' | 'not_requested' | 'draft_stale';

export interface AttentionItem {
  quote_id: number;
  quote_no: string | null;
  customer: string | null;
  sales_user_id: string | null;
  final_price: number | null;
  kind: AttentionKind;
  /** 얼마나 묵었는지(일) */
  days: number;
}

/** 며칠 지나면 챙겨야 하는가 — 영업이 손으로 세지 않아도 되게 기준을 못 박는다. */
export const ATTENTION_DAYS = { sign_pending: 3, not_requested: 3, draft_stale: 7 } as const;

/**
 * 성과 숫자보다 이쪽이 매출에 가깝다 — **오늘 전화할 목록**.
 *   sign_pending   서명 요청은 갔는데 아직 안 끝남
 *   not_requested  견적서까지 만들어 놓고 서명 요청을 안 함
 *   draft_stale    임시저장으로 방치
 *
 * ⚠️ 숨긴 견적은 빼야 한다 — 안 쓰기로 하고 감춘 임시저장이 「오늘 할 일」에 계속 떴다(2026-09-16).
 */
export async function attentionList(salesUser?: string): Promise<AttentionItem[]> {
  if (!prisma) return [];
  const now = Date.now();
  const quotes = await prisma.quote.findMany({
    where: {
      ...VISIBLE,
      ...(salesUser ? { sales_user_id: salesUser } : {}),
      status: { in: ['draft', 'confirmed', 'contracted'] },
    },
    select: {
      id: true, quote_no: true, status: true, final_price: true, sales_user_id: true, created_at: true,
      customer: { select: { name: true } },
      contracts: { orderBy: { created_at: 'desc' }, take: 1, select: { status: true, sent_at: true } },
    },
  });

  const out: AttentionItem[] = [];
  for (const q of quotes) {
    const base = {
      quote_id: q.id, quote_no: q.quote_no, customer: q.customer?.name ?? null,
      sales_user_id: q.sales_user_id, final_price: q.final_price,
    };
    const c = q.contracts[0];
    const daysSince = (d: Date) => Math.floor((now - d.getTime()) / DAY);

    if (c?.sent_at && c.status !== 'COMPLETED' && !['REJECTED', 'CANCELED'].includes(c.status)) {
      const d = daysSince(c.sent_at);
      if (d >= ATTENTION_DAYS.sign_pending) out.push({ ...base, kind: 'sign_pending', days: d });
      continue;                                  // 서명 진행 중이면 다른 사유는 의미 없다
    }
    if (q.status === 'confirmed' && !c?.sent_at) {
      const d = daysSince(q.created_at);
      if (d >= ATTENTION_DAYS.not_requested) out.push({ ...base, kind: 'not_requested', days: d });
      continue;
    }
    if (q.status === 'draft') {
      const d = daysSince(q.created_at);
      if (d >= ATTENTION_DAYS.draft_stale) out.push({ ...base, kind: 'draft_stale', days: d });
    }
  }
  // 오래 묵은 것부터 — 먼저 손대야 할 순서
  return out.sort((a, b) => b.days - a.days);
}
