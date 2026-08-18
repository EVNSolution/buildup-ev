// 계약은 견적(quote) 기준 — 영업이 견적 확정 시점에 계약서(+견적서 동봉) 발송
export interface ContractInfo {
  id: number
  status: 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNING' | 'COMPLETED' | 'REJECTED' | 'CANCELED'
  /** PAPER = 종이로 체결하고 스캔본을 등록한 건(전자서명을 거치지 않았다) */
  signing_method: 'EMAIL' | 'KAKAO' | 'PAPER'
  is_paper?: boolean
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

/**
 * 서면계약 등록 — 종이로 체결한 계약서를 올려 **계약완료**로 만든다.
 *
 * ⚠️ multipart 라 `apiFetch` 를 쓰지 않는다. Content-Type 을 직접 넣으면 boundary 가 빠져
 *    서버가 본문을 못 읽는다 — fetch 가 FormData 를 보고 알아서 붙이게 둔다.
 */
export async function registerPaperContract(quoteId: number, file: File): Promise<ContractInfo> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/v1/quotes/${quoteId}/contract/paper`, {
    method: 'POST', credentials: 'include', body: fd,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json() as { data: ContractInfo }).data
}
