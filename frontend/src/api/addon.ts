/** 부가작업 — 관리자 + addon.manage 만. 특장사에게는 이 경로도 데이터도 없다 */
export interface AddonStepView {
  code: string
  track: 'prep' | 'work' | 'handover'
  label: string
  requires: string[]
  date_label: string | null
  done: boolean
  done_at: string | null
  done_by: string | null
  done_on: string | null
  can_complete: { ok: true } | { ok: false; reason: string }
  can_undo: { ok: true } | { ok: false; reason: string }
}
export interface AddonView {
  factory_done: boolean
  factory_done_at: string | null
  steps: AddonStepView[]
  finished: boolean
  target_on: string | null
  target_set_by: string | null
  delivered_on: string | null
}

async function call(path: string, init?: RequestInit): Promise<AddonView> {
  const res = await fetch(`/api/v1/orders/${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  const body = await res.json().catch(() => ({})) as { data?: AddonView; error?: { message?: string } }
  if (!res.ok || !body.data) throw new Error(body.error?.message ?? `부가작업 요청 실패: ${res.status}`)
  return body.data
}

export const fetchAddon = (orderId: number) => call(`${orderId}/addon`)
export const setAddonTarget = (orderId: number, date: string) =>
  call(`${orderId}/addon/target`, { method: 'PATCH', body: JSON.stringify({ date }) })
export const completeAddonStep = (orderId: number, code: string, date?: string) =>
  call(`${orderId}/addon/steps/${code}`, { method: 'PATCH', body: JSON.stringify(date ? { date } : {}) })
export const undoAddonStep = (orderId: number, code: string) =>
  call(`${orderId}/addon/steps/${code}/undo`, { method: 'PATCH', body: JSON.stringify({}) })
