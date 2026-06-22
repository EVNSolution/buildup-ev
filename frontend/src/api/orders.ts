import type { ApiOrder, Org } from '@shared/types/index'

export async function fetchOrders(
  params: { status?: string; from?: string; to?: string },
  email: string,
): Promise<ApiOrder[]> {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const url = `/api/v1/orders${q.toString() ? '?' + q.toString() : ''}`
  const res = await fetch(url, { headers: { 'X-User': email } })
  if (!res.ok) throw new Error(`주문 목록 로드 실패: ${res.status}`)
  const body = await res.json()
  return body.data
}

export async function updateOrderStatus(
  orderId: number,
  status: string,
  email: string,
): Promise<void> {
  const res = await fetch(`/api/v1/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-User': email },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message ?? `상태 변경 실패: ${res.status}`)
  }
}

export async function fetchMakerOrgs(email: string): Promise<Org[]> {
  const res = await fetch('/api/v1/orgs?type=MAKER', { headers: { 'X-User': email } })
  if (!res.ok) throw new Error(`특장사 목록 로드 실패: ${res.status}`)
  const body = await res.json()
  return body.data
}
