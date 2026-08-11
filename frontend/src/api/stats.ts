/** 영업 성과 조회 — SALES 는 본인 것만 내려온다(서버가 강제). */

export const FUNNEL = ['draft', 'confirmed', 'contracted', 'assigned', 'ordered', 'completed'] as const
export type FunnelStage = (typeof FUNNEL)[number]

export interface SalesStat {
  sales_user_id: string
  reached: Record<FunnelStage, number>
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

export function fetchSalesStats(p: { from?: string; to?: string; salesUser?: string } = {}): Promise<SalesStat[]> {
  const qs = new URLSearchParams()
  if (p.from) qs.set('from', p.from)
  if (p.to) qs.set('to', p.to)
  if (p.salesUser) qs.set('sales_user', p.salesUser)
  return get<SalesStat[]>(`/api/v1/stats/sales${qs.toString() ? '?' + qs : ''}`)
}

export function fetchAttention(salesUser?: string): Promise<AttentionItem[]> {
  const qs = salesUser ? `?sales_user=${encodeURIComponent(salesUser)}` : ''
  return get<AttentionItem[]>(`/api/v1/stats/attention${qs}`)
}
