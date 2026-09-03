/** 단계별 대화 — 이력이 목적이라 수정·삭제 API 는 없다 */

export interface StepComment {
  id: number
  step_code: string
  author: string
  author_role: string
  author_name: string | null
  body: string
  created_at: string
}

async function jsonOrThrow(res: Response, what: string) {
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `${what} 실패 (${res.status})`)
  }
  return res.json()
}

/** 단계마다 안 읽은 개수 — 버튼의 빨간 점 */
export async function fetchUnread(orderId: number): Promise<Record<string, number>> {
  const res = await fetch(`/api/v1/orders/${orderId}/step-comments/unread`, { credentials: 'include' })
  const b = await jsonOrThrow(res, '안 읽은 대화 조회') as { data: Record<string, number> }
  return b.data
}

/** 한 단계의 대화 — 여는 순간 읽음으로 처리된다(서버가 함께 한다) */
export async function fetchComments(
  orderId: number, stepCode: string,
): Promise<{ comments: StepComment[]; me: string }> {
  const res = await fetch(`/api/v1/orders/${orderId}/steps/${stepCode}/comments`, { credentials: 'include' })
  const b = await jsonOrThrow(res, '대화 조회') as { data: { comments: StepComment[]; me: string } }
  return b.data
}

/** 주문의 대화 전체(시간순) + 쓸 때 고를 단계 목록 */
export async function fetchAllComments(orderId: number): Promise<{
  comments: StepComment[]
  me: string
  steps: { code: string; label: string }[]
}> {
  const res = await fetch(`/api/v1/orders/${orderId}/step-comments`, { credentials: 'include' })
  const b = await jsonOrThrow(res, '대화 이력 조회') as { data: {
    comments: StepComment[]; me: string; steps: { code: string; label: string }[]
  } }
  return b.data
}

export async function postComment(
  orderId: number, stepCode: string, body: string,
): Promise<StepComment> {
  const res = await fetch(`/api/v1/orders/${orderId}/steps/${stepCode}/comments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  const b = await jsonOrThrow(res, '전송') as { data: StepComment }
  return b.data
}
