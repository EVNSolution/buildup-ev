// 계약은 견적(quote) 기준 — 영업이 견적 확정 시점에 계약서(+견적서 동봉) 발송
export interface ContractInfo {
  id: number
  status: 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNING' | 'COMPLETED' | 'REJECTED' | 'CANCELED'
  signing_method: 'EMAIL' | 'KAKAO'
  sent_at: string | null
  completed_at: string | null
  has_signed: boolean
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`)
  }
  const json = await res.json() as { data: T }
  return json.data
}

export async function fetchContract(quoteId: number): Promise<ContractInfo | null> {
  return apiFetch(`/api/v1/quotes/${quoteId}/contract`)
}

export async function sendContract(quoteId: number, method: 'EMAIL' | 'KAKAO'): Promise<ContractInfo> {
  return apiFetch(`/api/v1/quotes/${quoteId}/contract/send`, {
    method: 'POST',
    body: JSON.stringify({ signing_method: method }),
  })
}

export const contractSignedUrl = (quoteId: number) => `/api/v1/quotes/${quoteId}/contract/signed`
