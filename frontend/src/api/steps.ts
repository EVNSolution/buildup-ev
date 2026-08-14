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
  /** 이 단계에 너무 오래 머물렀나 — 판정은 서버가 한다(같은 함수를 쓴다) */
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

export async function fetchSteps(orderId: number): Promise<ApiStep[]> {
  const res = await fetch(`/api/v1/orders/${orderId}/steps`, { credentials: 'include' })
  const body = await jsonOrThrow(res, '단계 조회') as { data: ApiStep[] }
  return body.data
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
