/** 알림함 — 헤더 종 아이콘이 쓴다. 자기 알림만 오간다(서버가 주인을 따진다). */
export interface InboxItem {
  id: number
  title: string
  body: string
  /** 눌렀을 때 열 화면 */
  url: string
  created_at: string
  read_at: string | null
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what}: ${res.status}`)
  return res.json() as Promise<T>
}

export async function fetchInbox(before?: number): Promise<{ data: InboxItem[]; unread: number; next_before: number | null }> {
  const q = before ? `?before=${before}` : ''
  return json(await fetch(`/api/v1/notifications${q}`, { credentials: 'include' }), '알림 불러오기 실패')
}

export async function fetchUnreadCount(): Promise<number> {
  const b = await json<{ data: { unread: number } }>(
    await fetch('/api/v1/notifications/unread-count', { credentials: 'include' }), '알림 개수 실패')
  return b.data.unread
}

export async function markRead(id: number): Promise<number> {
  const b = await json<{ data: { unread: number } }>(
    await fetch(`/api/v1/notifications/${id}/read`, { method: 'POST', credentials: 'include' }), '읽음 처리 실패')
  return b.data.unread
}

export async function markAllRead(): Promise<void> {
  await json(await fetch('/api/v1/notifications/read-all', { method: 'POST', credentials: 'include' }), '모두 읽음 실패')
}
