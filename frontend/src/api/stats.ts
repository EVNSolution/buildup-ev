/** 영업 성과 조회 — SALES 는 본인 것만 내려온다(서버가 강제). */

export const FUNNEL = ['draft', 'confirmed', 'contracted', 'assigned', 'ordered', 'completed'] as const
export type FunnelStage = (typeof FUNNEL)[number]

export interface SalesStat {
  sales_user_id: string
  /** 단계별 **건수** — 견적의 **현재 상태** 기준(되돌린 건은 그 자리에서 빠진다) */
  reached: Record<FunnelStage, number>
  /** 단계별 **고객 수** — 한 고객에게 여러 건이 나가도 1명. `customers.draft` = 상담고객 */
  customers: Record<FunnelStage, number>
  /** 견적완료 금액은 고객당 가장 최근 견적 한 건만 더한 값이다 */
  amount: { confirmed: number; contracted: number; completed: number }
  activity: { quotes: number; emailed: number; sign_requested: number; edits: number }
  lead: {
    to_confirmed: { days: number | null; n: number }
    to_contracted: { days: number | null; n: number }
    to_completed: { days: number | null; n: number }
  }
  signing: { email_sent: number; email_done: number; kakao_sent: number; kakao_done: number }
  edits_per_quote: number | null
}

export type AttentionKind = 'sign_pending' | 'not_requested' | 'draft_stale'

export interface AttentionItem {
  quote_id: number
  quote_no: string | null
  customer: string | null
  sales_user_id: string | null
  final_price: number | null
  kind: AttentionKind
  days: number
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `조회 실패: ${res.status}`)
  }
  return (await res.json() as { data: T }).data
}

/** 계정별 줄 + **서버가 낸 전체 합계**. 합계를 화면에서 더하면 고객 수가 어긋난다 */
export interface SalesStatsRes { rows: SalesStat[]; total: SalesStat }

export async function fetchSalesStats(p: { from?: string; to?: string; salesUser?: string } = {}): Promise<SalesStatsRes> {
  const qs = new URLSearchParams()
  if (p.from) qs.set('from', p.from)
  if (p.to) qs.set('to', p.to)
  if (p.salesUser) qs.set('sales_user', p.salesUser)
  const url = `/api/v1/stats/sales${qs.toString() ? '?' + qs : ''}`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `조회 실패: ${res.status}`)
  }
  const body = await res.json() as { data: SalesStat[]; total: SalesStat }
  return { rows: body.data, total: body.total }
}

export function fetchAttention(salesUser?: string): Promise<AttentionItem[]> {
  const qs = salesUser ? `?sales_user=${encodeURIComponent(salesUser)}` : ''
  return get<AttentionItem[]>(`/api/v1/stats/attention${qs}`)
}
