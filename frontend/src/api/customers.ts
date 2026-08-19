// 고객 정리 화면 — 숨기기(soft hide)로 화면에서만 감춘다. 지우지 않는다.
export interface AdminCustomer {
  id: number
  name: string
  phone: string | null
  email: string | null
  reg_no: string | null
  /** WARP 정본 고객 ID — 값이 있으면 **숨길 수 없다**(CRM 쪽에서 사라진 것처럼 보인다) */
  warp_customer_id: string | null
  created_by: string | null
  created_at: string
  hidden_at: string | null
  hidden_by: string | null
  _count: { quotes: number }
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b?.error?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json() as { data: T }).data
}

export const fetchCustomers = (includeHidden: boolean) =>
  req<AdminCustomer[]>(`/api/v1/customers${includeHidden ? '?include_hidden=true' : ''}`)

export const setCustomerHidden = (id: number, hidden: boolean) =>
  req<AdminCustomer>(`/api/v1/customers/${id}/hidden`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden }),
  })
