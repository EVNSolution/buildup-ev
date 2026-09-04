/** 단계별 대화 — 이력이 목적이라 수정·삭제 API 는 없다 */

export interface StepComment {
  id: number
  step_code: string
  author: string
  author_role: string
  author_name: string | null
  body: string
  /** 붙인 사진(order_file.id). 없으면 null */
  image_file_id: number | null
  created_at: string
}

/** 대화에 붙은 사진 주소 — 증빙 파일과 같은 길을 쓴다 */
export const commentImageUrl = (orderId: number, fileId: number) =>
  `/api/v1/orders/${orderId}/files/${fileId}`

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

/**
 * 한 단계의 대화 — 여는 순간 읽음으로 처리된다(서버가 함께 한다).
 *
 * `after` 를 주면 **그 뒤에 생긴 것만** 받는다. 몇 초마다 다시 물어볼 때 쓴다 —
 * 처음부터 전부 받으면 대화가 길어질수록 오가는 양이 계속 커진다.
 */
export async function fetchComments(
  orderId: number, stepCode: string, after?: number,
): Promise<{ comments: StepComment[]; me: string }> {
  const q = after != null && after > 0 ? `?after=${after}` : ''
  const res = await fetch(`/api/v1/orders/${orderId}/steps/${stepCode}/comments${q}`, { credentials: 'include' })
  const b = await jsonOrThrow(res, '대화 조회') as { data: { comments: StepComment[]; me: string } }
  return b.data
}

/**
 * 주문의 대화 전체(시간순) + 쓸 때 고를 단계 목록.
 *
 * `after` 를 주면 **그 뒤에 생긴 것만** 받고, 단계 목록은 오지 않는다(처음 한 번이면 된다).
 * 14줄짜리 고정 목록을 몇 초마다 다시 실어 보내면 증분으로 아낀 것을 도로 쓴다.
 */
export async function fetchAllComments(orderId: number, after?: number): Promise<{
  comments: StepComment[]
  me: string
  steps?: { code: string; label: string }[]
}> {
  const q = after != null && after > 0 ? `?after=${after}` : ''
  const res = await fetch(`/api/v1/orders/${orderId}/step-comments${q}`, { credentials: 'include' })
  const b = await jsonOrThrow(res, '대화 이력 조회') as { data: {
    comments: StepComment[]; me: string; steps?: { code: string; label: string }[]
  } }
  return b.data
}

/**
 * 글 남기기 — 사진을 함께 붙일 수 있다.
 *
 * multipart 로 보낸다(글만 보낼 때도 같은 길). `Content-Type` 을 직접 적지 않는다 —
 * 브라우저가 경계 문자열까지 넣어 만들어 줘야 서버가 읽는다.
 */
export async function postComment(
  orderId: number, stepCode: string, body: string, image?: File | null,
): Promise<StepComment> {
  const fd = new FormData()
  fd.append('body', body)
  if (image) fd.append('image', image)
  const res = await fetch(`/api/v1/orders/${orderId}/steps/${stepCode}/comments`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  const b = await jsonOrThrow(res, '전송') as { data: StepComment }
  return b.data
}
