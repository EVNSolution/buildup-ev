import type { ApiOrder, ApiOrderMakerDetail, OrderVehicleInfo, Org } from '@shared/types/index'

export async function fetchOrders(
  /** `scope: 'mine'` — 영업 화면에서 붙인다(겸직 계정이라도 남의 주문은 안 본다) */
  params: { status?: string; from?: string; to?: string; scope?: 'mine' },
): Promise<ApiOrder[]> {
  const q = new URLSearchParams()
  if (params.scope) q.set('scope', params.scope)
  if (params.status) q.set('status', params.status)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const url = `/api/v1/orders${q.toString() ? '?' + q.toString() : ''}`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`주문 목록 로드 실패: ${res.status}`)
  const body = await res.json() as { data: ApiOrder[] }
  return body.data
}

export async function updateOrderStatus(orderId: number, status: string): Promise<void> {
  const res = await fetch(`/api/v1/orders/${orderId}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `상태 변경 실패: ${res.status}`)
  }
}

/**
 * 특장사 주문 수락 (배정→주문, 제작 착수).
 * 납기일을 **함께** 보낸다 — 따로 받으면 납기 없는 주문이 생긴다.
 */
export async function acceptOrder(orderId: number, deliveryDue: string): Promise<void> {
  const res = await fetch(`/api/v1/orders/${orderId}/accept`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delivery_due: deliveryDue }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `주문 수락 실패: ${res.status}`)
  }
}

export async function fetchOrderDetail(id: number): Promise<ApiOrderMakerDetail> {
  const res = await fetch(`/api/v1/orders/${id}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`주문 상세 로드 실패: ${res.status}`)
  const body = await res.json() as { data: ApiOrderMakerDetail }
  return body.data
}

export async function fetchMakerOrgs(): Promise<Org[]> {
  const res = await fetch('/api/v1/orgs?type=MAKER', { credentials: 'include' })
  if (!res.ok) throw new Error(`특장사 목록 로드 실패: ${res.status}`)
  const body = await res.json() as { data: Org[] }
  return body.data
}

export async function saveVehicleInfo(orderId: number, info: OrderVehicleInfo): Promise<void> {
  const res = await fetch(`/api/v1/orders/${orderId}/vehicle-info`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `차량정보 저장 실패: ${res.status}`)
  }
}
