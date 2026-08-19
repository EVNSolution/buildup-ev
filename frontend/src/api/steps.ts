import type { EvidenceKind, StepStatus, Track } from '@shared/process/steps'

/** 단계 한 건 — 서버가 카탈로그 순서로 내려준다(화면이 다시 정렬하지 않는다). */
export interface ApiStep {
  code: string
  track: Track
  status: StepStatus
  planned_at: string | null
  entered_at: string | null
  done_at: string | null
  done_by: string | null
  note: string | null
  /** 약속한 마감 (YYYY-MM-DD). 마감이 없는 단계는 null */
  due_at: string | null
  /** 마감을 며칠 넘겼나. 안 넘겼거나 마감이 없으면 null */
  overdue_days: number | null
  /** 지연 = 약속한 날을 넘겼고 지금 손댈 수 있는데 안 끝난 것 */
  stalled: boolean
  files: ApiStepFile[]
}

export interface ApiStepFile {
  id: number
  kind: EvidenceKind
  name: string | null
  size: number | null
  kept_original: boolean
  uploaded_by: string
  uploaded_at: string
}

async function jsonOrThrow(res: Response, what: string) {
  if (res.ok) return res.json()
  const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
  throw new Error(body.error?.message ?? `${what} 실패: ${res.status}`)
}

/**
 * 단계 목록 + **주문 자체의 기록**.
 * 발주 발행·수락·납기는 단계가 아니라 이미 끝난 사실이라 따로 온다.
 */
export interface ApiStepsResponse {
  data: ApiStep[]
  order: {
    assigned_at: string | null
    accepted_at: string | null
    /** YYYY-MM-DD */
    delivery_due: string | null
    /** 특장만 주문 — 차량 트랙이 「차량 도착」 하나로 줄어든다 */
    body_only: boolean
  }
}

export async function fetchSteps(orderId: number): Promise<ApiStepsResponse> {
  const res = await fetch(`/api/v1/orders/${orderId}/steps`, { credentials: 'include' })
  return await jsonOrThrow(res, '단계 조회') as ApiStepsResponse
}

/** 단계 완료. 날짜를 받는 단계(납기·검사예정일·인도일)는 plannedAt 을 함께 보낸다. */
export async function completeStep(orderId: number, code: string, plannedAt?: string): Promise<void> {
  const res = await fetch(`/api/v1/orders/${orderId}/steps/${code}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plannedAt ? { planned_at: plannedAt } : {}),
  })
  await jsonOrThrow(res, '단계 완료')
}

/** 완료를 되돌린다. 뒤 단계가 이미 끝났으면 서버가 막는다. */
export async function undoStep(orderId: number, code: string): Promise<void> {
  const res = await fetch(`/api/v1/orders/${orderId}/steps/${code}/undo`, {
    method: 'PATCH', credentials: 'include',
  })
  await jsonOrThrow(res, '되돌리기')
}

export async function uploadStepFile(
  orderId: number, code: string, kind: EvidenceKind, file: File,
): Promise<ApiStepFile> {
  const form = new FormData()
  form.append('kind', kind)
  form.append('file', file)
  const res = await fetch(`/api/v1/orders/${orderId}/steps/${code}/files`, {
    method: 'POST', credentials: 'include', body: form,
  })
  const body = await jsonOrThrow(res, '파일 올리기') as { data: ApiStepFile }
  return body.data
}

export async function deleteStepFile(orderId: number, fileId: number): Promise<void> {
  const res = await fetch(`/api/v1/orders/${orderId}/files/${fileId}`, {
    method: 'DELETE', credentials: 'include',
  })
  await jsonOrThrow(res, '파일 삭제')
}

export const stepFileUrl = (orderId: number, fileId: number) =>
  `/api/v1/orders/${orderId}/files/${fileId}`
