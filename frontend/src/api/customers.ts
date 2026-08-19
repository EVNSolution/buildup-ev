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
  /** 계약이 붙은 견적 수 — 0 이 아니면 실거래라 숨길 수 없다 */
  contract_quotes: number
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b?.error?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json() as { data: T }).data
}

/** 'active' = 사용 중만 · 'hidden' = **숨긴 것만**(섞이지 않는다) */
export const fetchCustomers = (view: 'active' | 'hidden') =>
  req<AdminCustomer[]>(`/api/v1/customers${view === 'hidden' ? '?view=hidden' : ''}`)

/** 숨기면 그 고객의 견적도 함께 숨겨진다(응답의 quotes_affected 가 몇 건인지 알려 준다). */
export const setCustomerHidden = (id: number, hidden: boolean) =>
  req<AdminCustomer & { quotes_affected: number }>(`/api/v1/customers/${id}/hidden`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden }),
  })
