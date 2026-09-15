import type { CheckResult } from '@shared/process/steps'

/** 체크리스트 **서식** 한 줄 — 관리자가 고치는 것 */
export interface ChecklistItem {
  id: number
  step_code: string
  seq: number
  category: string
  content: string
  active: boolean
}

/** 주문에 얼려 둔 체크리스트 한 줄 — 그 시점의 서식 사본 + 판정 */
export interface OrderChecklistLine {
  id: number
  seq: number
  category: string
  content: string
  result: CheckResult | null
  memo: string | null
  checked_at: string | null
  checked_by: string | null
  /** 조치 후 재검 이력 — 「한 번에 통과」와 「고쳐서 통과」는 다른 이야기다 */
  logs: { result: CheckResult; memo: string | null; at: string; by: string }[]
}

export interface OrderChecklist {
  step_code: string
  /** 적는 사람 역할 — 내 역할이 아니면 보기만 한다 */
  actor: 'ADMIN' | 'MAKER' | 'SALES'
  submitted_at: string | null
  submitted_by: string | null
  lines: OrderChecklistLine[]
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `${what} (${res.status})`)
  }
  return (await res.json() as { data: T }).data
}

/** 서식을 붙일 수 있는 단계 — 특장사 진행(maker)·부가작업 진행(addon) 두 묶음, count = 켜진 항목 수 */
export interface ChecklistStepOption { group: 'maker' | 'addon'; track: string; code: string; label: string; actor: string; count: number }

export async function fetchChecklistSteps(): Promise<ChecklistStepOption[]> {
  return json(await fetch('/api/v1/checklists/steps', { credentials: 'include' }), '단계 목록을 불러오지 못했습니다')
}

export async function fetchChecklistItems(step: string): Promise<ChecklistItem[]> {
  return json(await fetch(`/api/v1/checklists?step=${encodeURIComponent(step)}`, { credentials: 'include' }), '서식을 불러오지 못했습니다')
}

export async function saveChecklistItems(
  step: string, items: { id?: number; category: string; content: string }[],
): Promise<ChecklistItem[]> {
  return json(await fetch('/api/v1/checklists', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, items }),
  }), '서식을 저장하지 못했습니다')
}

/** 특장사 단계는 `steps`, 부가작업 단계(관리자 전용)는 `addon` 경로 */
export type ChecklistScope = 'steps' | 'addon'
const checklistPath = (orderId: number, step: string, scope: ChecklistScope) =>
  `/api/v1/orders/${orderId}/${scope === 'addon' ? 'addon/steps' : 'steps'}/${step}/checklist`

export async function fetchOrderChecklist(orderId: number, step: string, scope: ChecklistScope = 'steps'): Promise<OrderChecklist | null> {
  return json(await fetch(checklistPath(orderId, step, scope), { credentials: 'include' }), '체크리스트를 불러오지 못했습니다')
}

export async function saveOrderChecklist(
  orderId: number, step: string,
  lines: { id: number; result: CheckResult; memo?: string }[],
  submit = false,
  scope: ChecklistScope = 'steps',
): Promise<{ all_pass: boolean }> {
  return json(await fetch(checklistPath(orderId, step, scope), {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines, submit }),
  }), '체크리스트를 저장하지 못했습니다')
}
