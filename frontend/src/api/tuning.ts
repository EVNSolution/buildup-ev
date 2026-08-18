// 튜닝신청서 전자서명 — 계약서(api/contracts.ts)와 같은 모양. 붙는 대상만 주문이다.
export interface TuningInfo {
  id: number
  status: 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNING' | 'COMPLETED' | 'REJECTED' | 'CANCELED'
  signing_method: 'EMAIL' | 'KAKAO'
  sent_at: string | null
  completed_at: string | null
  has_signed: boolean
  /** 서명본을 실제로 내려받은 시각 — 이게 있어야 「서명 완료」 단계를 넘길 수 있다 */
  downloaded_at: string | null
  downloaded_by: string | null
}

/** 발송 전에 보여 줄 수신자 — 신청인(등록증 소유자)과 연락처 주인(고객)이 다를 수 있다. */
export interface TuningRecipient {
  owner_name: string; customer_name: string; email: string; phone: string; mismatch: boolean
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b?.error?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json() as { data: T }).data
}

export async function fetchTuning(orderId: number): Promise<{ data: TuningInfo | null; recipient: TuningRecipient | null }> {
  const res = await fetch(`/api/v1/orders/${orderId}/tuning`, { credentials: 'include' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b?.error?.message ?? `HTTP ${res.status}`)
  }
  return await res.json() as { data: TuningInfo | null; recipient: TuningRecipient | null }
}

export const sendTuning = (orderId: number, method: 'EMAIL' | 'KAKAO') =>
  req<TuningInfo>(`/api/v1/orders/${orderId}/tuning/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signing_method: method }),
  })

export const tuningSignedUrl = (orderId: number) => `/api/v1/orders/${orderId}/tuning/signed`
