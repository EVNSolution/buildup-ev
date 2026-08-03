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

export async function fetchContract(orderId: number): Promise<ContractInfo | null> {
  return apiFetch(`/api/v1/orders/${orderId}/contract`)
}

export async function sendContract(orderId: number, method: 'EMAIL' | 'KAKAO'): Promise<ContractInfo> {
  return apiFetch(`/api/v1/orders/${orderId}/contract/send`, {
    method: 'POST',
    body: JSON.stringify({ signing_method: method }),
  })
}

export const contractSignedUrl = (orderId: number) => `/api/v1/orders/${orderId}/contract/signed`
