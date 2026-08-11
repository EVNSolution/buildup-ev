/**
 * 영업 성과 집계 — 계정별 깔때기·금액·활동량·속도, 그리고 「지금 붙어야 할 건」.
 *
 * 무엇을 세느냐보다 **무엇을 보고 움직일 수 있느냐**로 골랐다.
 *   깔때기 = 어디서 새는지 (사람마다 처방이 다르다)
 *   금액   = 건수만 보면 소액 견적을 많이 낸 쪽이 유리해진다
 *   누수   = 오늘 당장 전화할 목록 — 성과 측정보다 이쪽이 매출에 가깝다
 *
 * ⚠️ 전이 시각은 quote_change_log(section='status')에 쌓인다. 그 기록을 남기기 전에
 *    진행된 견적은 곁에 있는 시각으로 메우고(계약완료=서명완료, 배정=주문배정),
 *    그래도 없으면 **속도 계산에서 제외**한다. 없는 시간을 지어내지 않는다.
 */
import { prisma } from '../lib/prisma.js';
import { STATUS_SECTION, stageTimesOf } from './quote-status.js';

const DAY = 24 * 60 * 60 * 1000;

/** 깔때기 단계 — 화면 표기와 같은 순서 */
export const FUNNEL = ['draft', 'confirmed', 'contracted', 'assigned', 'ordered', 'completed'] as const;
export type FunnelStage = (typeof FUNNEL)[number];

export interface SalesStat {
  sales_user_id: string;
  /** 각 단계에 **도달한 적 있는** 견적 수(현재 상태가 아니라 누적 도달) */
  reached: Record<FunnelStage, number>;
  /** 금액 — 확정·계약·인도완료 기준(실구매가 합) */
  amount: { confirmed: number; contracted: number; completed: number };
  /** 활동량 */
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

export async function salesStats(range: StatsRange): Promise<SalesStat[]> {
  if (!prisma) return [];

  const where: Record<string, unknown> = {};
  if (range.salesUser) where['sales_user_id'] = range.salesUser;
  if (range.from || range.to) {
    where['created_at'] = { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) };
  }

  const quotes = await prisma.quote.findMany({
    where,
    select: {
      id: true, sales_user_id: true, status: true, final_price: true, created_at: true,
      docs_emailed_at: true,
      contracts: { select: { status: true, sent_at: true, completed_at: true, signing_method: true } },
      order: { select: { assigned_at: true } },
      change_logs: { select: { section: true, new_value: true, changed_at: true } },
    },
  });

  const byUser = new Map<string, SalesStat & { _lead: { c: number[]; k: number[]; d: number[] } }>();
  const blank = (user: string) => ({
    sales_user_id: user,
    reached: { draft: 0, confirmed: 0, contracted: 0, assigned: 0, ordered: 0, completed: 0 },
    amount: { confirmed: 0, contracted: 0, completed: 0 },
    activity: { quotes: 0, emailed: 0, sign_requested: 0, edits: 0 },
    lead: { to_confirmed: { days: null, n: 0 }, to_contracted: { days: null, n: 0 }, to_completed: { days: null, n: 0 } },
    signing: { email_sent: 0, email_done: 0, kakao_sent: 0, kakao_done: 0 },
    edits_per_quote: null,
    _lead: { c: [], k: [], d: [] },
  } as SalesStat & { _lead: { c: number[]; k: number[]; d: number[] } });

  for (const q of quotes) {
    const user = q.sales_user_id ?? '(미지정)';
    if (!byUser.has(user)) byUser.set(user, blank(user));
    const st = byUser.get(user)!;

    const statusLogs = q.change_logs.filter((l) => l.section === STATUS_SECTION);
    const latestContract = q.contracts[0];
    const t = stageTimesOf(q, statusLogs, {
      contracted: latestContract?.completed_at ?? null,
      assigned: q.order?.assigned_at ?? null,
    });

    // 도달 = 그 단계 시각이 있거나, 지금 그 단계를 이미 지나왔거나
    const idxNow = FUNNEL.indexOf(q.status as FunnelStage);
    FUNNEL.forEach((stage, i) => {
      const reached = i === 0 || t[stage] !== null || (idxNow >= 0 && idxNow >= i);
      if (reached) st.reached[stage] += 1;
    });

    const price = q.final_price ?? 0;
    if (idxNow >= 1) st.amount.confirmed += price;
    if (idxNow >= 2) st.amount.contracted += price;
    if (idxNow >= 5) st.amount.completed += price;

    st.activity.quotes += 1;
    if (q.docs_emailed_at) st.activity.emailed += 1;
    if (q.contracts.some((c) => c.sent_at)) st.activity.sign_requested += 1;
    st.activity.edits += q.change_logs.filter((l) => l.section !== STATUS_SECTION).length;

    for (const c of q.contracts) {
      if (!c.sent_at) continue;
      const kakao = c.signing_method === 'KAKAO';
      if (kakao) st.signing.kakao_sent += 1; else st.signing.email_sent += 1;
      if (c.status === 'COMPLETED') { if (kakao) st.signing.kakao_done += 1; else st.signing.email_done += 1; }
    }

    if (t.confirmed) st._lead.c.push((t.confirmed.getTime() - t.draft.getTime()) / DAY);
    if (t.contracted) st._lead.k.push((t.contracted.getTime() - t.draft.getTime()) / DAY);
    if (t.completed) st._lead.d.push((t.completed.getTime() - t.draft.getTime()) / DAY);
  }

  return [...byUser.values()].map(({ _lead, ...s }) => ({
    ...s,
    lead: {
      to_confirmed: avgDays(_lead.c),
      to_contracted: avgDays(_lead.k),
      to_completed: avgDays(_lead.d),
    },
    edits_per_quote: s.activity.quotes ? Math.round((s.activity.edits / s.activity.quotes) * 10) / 10 : null,
  }));
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
 */
export async function attentionList(salesUser?: string): Promise<AttentionItem[]> {
  if (!prisma) return [];
  const now = Date.now();
  const quotes = await prisma.quote.findMany({
    where: {
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
